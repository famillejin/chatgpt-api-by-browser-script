// ==UserScript==
// @name         ChatGPT API By Browser Script
// @namespace    http://tampermonkey.net/
// @version      19
// @match        https://chatgpt.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=openai.com
// @grant        GM_webRequest
// @license MIT
// ==/UserScript==

const log = (...args) => {
    console.log('chatgpt-api-by-browser-script', ...args);
};
log('starting');

const WS_URL = `ws://localhost:8765`;

function cleanText(inputText) {
    // Avoid control characters and invisible chars with a safer regex
    // eslint-disable-next-line no-control-regex, no-misleading-character-class
    const invisibleCharsRegex = /[\u200B\u200C\u200D\uFEFF]|[\u0000-\u001F\u007F-\u009F]/g;
    return inputText.replace(invisibleCharsRegex, '');
}

function getTextFromNode(node) {
    if (!node) return '';

    if (node.classList.contains('invisible')) {
        return '';
    }

    let result = '';
    const childNodes = node.childNodes;
    for (let i = 0; i < childNodes.length; i++) {
        const childNode = childNodes[i];
        if (childNode.nodeType === Node.TEXT_NODE) {
            result += childNode.textContent;
        } else if (childNode.nodeType === Node.ELEMENT_NODE) {
            result += getTextFromNode(childNode);
        }
    }
    return cleanText(result);
}

function sleep(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}

// Debounce function to prevent multiple calls
function debounce(func, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

function extractFormattedContent(node) {
    let result = '';

    function traverse(currentNode) {
        if (currentNode.nodeType === Node.TEXT_NODE) {
            result += currentNode.textContent;
        } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
            if (currentNode.tagName === 'P') {
                // Process all children of the paragraph
                for (const child of currentNode.childNodes) {
                    traverse(child);
                }
                result += '\n'; // Add newline after paragraphs
            } else if (currentNode.tagName === 'PRE') {
                const code = currentNode.querySelector('code');
                if (code) {
                    result += '```\n' + code.textContent + '\n```\n';
                } else {
                    result += '```\n' + currentNode.textContent + '\n```\n';
                }
            } else if (currentNode.tagName === 'CODE' && currentNode.parentNode.tagName !== 'PRE') {
                // Only process inline code that's not inside a PRE
                result += '`' + currentNode.textContent + '`';
            } else if (currentNode.tagName === 'UL' || currentNode.tagName === 'OL') {
                // Process all list items
                for (const child of currentNode.childNodes) {
                    traverse(child);
                }
                result += '\n';
            } else if (currentNode.tagName === 'LI') {
                result += '- '; // Add list item marker
                for (const child of currentNode.childNodes) {
                    traverse(child);
                }
                result += '\n';
            } else {
                // Traverse all other elements recursively
                for (const child of currentNode.childNodes) {
                    traverse(child);
                }
            }
        }
    }

    traverse(node);
    return result.trim();
}

class App {
    constructor() {
        this.socket = null;
        this.observer = null;
        this.stop = false;
        this.dom = null;
        this.lastText = null;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async start({ text, model, newChat }) {
        this.stop = false;
        log('Starting to send a message');

        // Try multiple selectors to handle different browsers (Chrome, Edge, etc.)
        const textarea = document.querySelector('#prompt-textarea') ||
                        document.querySelector('div[contenteditable="true"]');

        if (textarea) {
            log('Found input area:', textarea);
            textarea.focus();
            textarea.textContent = text;
            textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));

            // Wait for the send button to appear
            await sleep(500); // Adjust the delay if needed

            // Try multiple selectors for the send button
            const sendButton = document.querySelector('button[aria-label="Send prompt"]') ||
                               document.querySelector('button[aria-label="Envoyer le message"]') ||
                               document.querySelector('button[data-testid="send-button"]') ||
                               // Find button with an SVG child that resembles a send icon
                               Array.from(document.querySelectorAll('button')).find(button =>
                                 button.innerHTML.includes('svg') &&
                                 (button.getAttribute('aria-label')?.toLowerCase().includes('send') ||
                                  button.getAttribute('aria-label')?.toLowerCase().includes('envoyer'))
                               );

            if (sendButton) {
                log('Found send button, clicking...');
                sendButton.click();
                this.observeMutations();
            } else {
                log('Error: Send button not found. Available buttons:',
                    Array.from(document.querySelectorAll('button'))
                    .filter(b => b.getAttribute('aria-label'))
                    .map(b => b.getAttribute('aria-label')));
            }
        } else {
            log('Error: Textarea not found. DOM structure:', document.body.innerHTML.substring(0, 500));
        }
    }

    async observeMutations() {
        let lastScrollDownClick = 0;
        let checkForCopyTimeout = null;

        this.observer = new MutationObserver(async (mutations) => {
            // Check for the stop icon (square) which indicates generation is still in progress
            const stopIcon = document.querySelector('svg rect[x="7"][y="7"][width="10"][height="10"][rx="1.25"]');

            // If stop icon is visible, we're still generating
            if (stopIcon) {
                console.log("Generation in progress (stop icon visible)");
                clearTimeout(checkForCopyTimeout);

                // Also check for scroll down button and click it to ensure we see all content
                const scrollDownButton = document.querySelector('button.cursor-pointer.absolute.z-10.rounded-full.bg-clip-padding.border.text-token-text-secondary.border-token-border-light.right-1\\/2.translate-x-1\\/2.bg-token-main-surface-primary.w-8.h-8.flex.items-center.justify-center.bottom-5') ||
                                        document.querySelector('button svg[viewBox="0 0 24 24"] path[d="M12 21C11.7348 21 11.4804 20.8946 11.2929 20.7071L4.29289 13.7071C3.90237 13.3166 3.90237 12.6834 4.29289 12.2929C4.68342 11.9024 5.31658 11.9024 5.70711 12.2929L11 17.5858V4C11 3.44772 11.4477 3 12 3C12.5523 3 13 3.44772 13 4V17.5858L18.2929 12.2929C18.6834 11.9024 19.3166 11.9024 19.7071 12.2929C20.0976 12.6834 20.0976 13.3166 19.7071 13.7071L12.7071 20.7071C12.5196 20.8946 12.2652 21 12 21Z"]')?.closest('button');

                if (scrollDownButton) {
                    const now = Date.now();
                    if (now - lastScrollDownClick > 100) {
                        console.log("Clicking scroll down button during generation");
                        scrollDownButton.click();
                        lastScrollDownClick = now;

                        // Wait and check if it's still visible
                        await sleep(200);
                        const scrollDownButtonStillVisible = document.querySelector('button.cursor-pointer.absolute.z-10.rounded-full.bg-clip-padding.border.text-token-text-secondary.border-token-border-light.right-1\\/2.translate-x-1\\/2.bg-token-main-surface-primary.w-8.h-8.flex.items-center.justify-center.bottom-5') ||
                                                           document.querySelector('button svg[viewBox="0 0 24 24"] path[d="M12 21C11.7348 21 11.4804 20.8946 11.2929 20.7071L4.29289 13.7071C3.90237 13.3166 3.90237 12.6834 4.29289 12.2929C4.68342 11.9024 5.31658 11.9024 5.70711 12.2929L11 17.5858V4C11 3.44772 11.4477 3 12 3C12.5523 3 13 3.44772 13 4V17.5858L18.2929 12.2929C18.6834 11.9024 19.3166 11.9024 19.7071 12.2929C20.0976 12.6834 20.0976 13.3166 19.7071 13.7071L12.7071 20.7071C12.5196 20.8946 12.2652 21 12 21Z"]')?.closest('button');
                        if (scrollDownButtonStillVisible) {
                            scrollDownButton.click();
                        }
                    }
                }
                return; // Don't proceed further while generating
            }

            // Look for the voice input icon (generation complete)
            const voiceInputIcon = document.querySelector('svg path[d="M9.5 4C8.67157 4 8 4.67157 8 5.5V18.5C8 19.3284 8.67157 20 9.5 20C10.3284 20 11 19.3284 11 18.5V5.5C11 4.67157 10.3284 4 9.5 4Z"]');

            if (voiceInputIcon) {
                console.log("Generation complete (voice icon visible)");

                // One final check for any scroll buttons
                const scrollDownButton = document.querySelector('button.cursor-pointer.absolute.z-10.rounded-full.bg-clip-padding.border.text-token-text-secondary.border-token-border-light.right-1\\/2.translate-x-1\\/2.bg-token-main-surface-primary.w-8.h-8.flex.items-center.justify-center.bottom-5') ||
                                        document.querySelector('button svg[viewBox="0 0 24 24"] path[d="M12 21C11.7348 21 11.4804 20.8946 11.2929 20.7071L4.29289 13.7071C3.90237 13.3166 3.90237 12.6834 4.29289 12.2929C4.68342 11.9024 5.31658 11.9024 5.70711 12.2929L11 17.5858V4C11 3.44772 11.4477 3 12 3C12.5523 3 13 3.44772 13 4V17.5858L18.2929 12.2929C18.6834 11.9024 19.3166 11.9024 19.7071 12.2929C20.0976 12.6834 20.0976 13.3166 19.7071 13.7071L12.7071 20.7071C12.5196 20.8946 12.2652 21 12 21Z"]')?.closest('button');

                if (scrollDownButton) {
                    console.log("Doing final scroll down click before extraction");
                    scrollDownButton.click();

                    // Wait a bit to ensure scroll is complete
                    await sleep(300);
                }

                // Now check for copy button and extract content
                checkForCopyTimeout = setTimeout(() => {
                    console.log("Checking for copy button after generation complete");
                    this.checkForCopyButton();
                }, 500);
            }

            // Check for the "I prefer this response" button
            const preferButton = document.querySelector('button[data-testid="paragen-prefer-response-button"]');
            if (preferButton) {
                preferButton.click();
            }
        });

        const observerConfig = {
            childList: true,
            subtree: true,
            characterData: true,
        };
        this.observer.observe(document.body, observerConfig);
    }



    async checkForCopyButton() {
        console.log("checkForCopyButton called - v23");
        // Try multiple selectors for the copy button in different browsers
        const copyButton = document.querySelector('button[data-testid="copy-turn-action-button"]') ||
                           document.querySelector('button[aria-label*="Copy"]') ||
                           document.querySelector('button[aria-label*="Copier"]');

        if (copyButton) {
            console.log("Copy button appeared:", copyButton);

            try {
                console.log("EXTRACTING LAST CONVERSATION TURN:");

                let messageContainers = document.querySelectorAll('.group\\/conversation-turn');
                let messageContainer = null;

                if (messageContainers && messageContainers.length > 0) {
                    messageContainer = messageContainers[messageContainers.length - 1];
                    console.log("Found container using original method" );
                }


                if (messageContainer) {
                    // Work on a copy of the message container
                    messageContainer = messageContainer.cloneNode(true);

                    // Extract the text content from the message container
                    //let textContent = getTextFromNode(messageContainer);
                    let textContent = extractFormattedContent(messageContainer);
                    console.log("Traditional extraction result:", textContent);

                    // Using test case approach to properly handle the message
                    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                        // Send answer message
                        const answerPayload = {
                            type: 'answer',
                            text: textContent
                        };

                        console.log("Sending answer with length:", textContent.length);
                        this.socket.send(JSON.stringify(answerPayload));

                        // Disconnect observer to stop monitoring
                        this.observer.disconnect();
                        this.stop = true;

                        // Send stop message
                        const stopPayload = {
                            type: 'stop'
                        };

                        this.socket.send(JSON.stringify(stopPayload));
                    } else {
                        console.error("WebSocket is not open, cannot send message");
                    }
                }

                this.observer.disconnect();
                this.stop = true;
            } catch (error) {
                console.error("Error in checkForCopyButton:", error);
            }
        }
    }

    sendHeartbeat() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            log('Sending heartbeat');
            const heartbeatPayload = {
                type: 'heartbeat'
            };
            this.socket.send(JSON.stringify(heartbeatPayload));
        }
    }

    connect() {
        this.socket = new WebSocket(WS_URL);

        this.socket.onopen = () => {
            log('Server connected, can process requests now.');
            this.dom.innerHTML = '<div style="color: green;">API Connected!</div>';
        };

        this.socket.onmessage = (event) => {
            try {
                // Ensure proper handling of websocket message data
                let data;
                if (typeof event.data === 'string') {
                    data = event.data;
                } else if (event.data instanceof Blob) {
                    // For blob data (rarely happens in browser WebSocket)
                    const reader = new FileReader();
                    reader.onload = () => {
                        try {
                            const text = reader.result;
                            this.processMessage(text);
                        } catch (innerError) {
                            console.error('Error processing Blob result:', innerError);
                        }
                    };
                    reader.readAsText(event.data);
                    return;
                } else {
                    data = event.data;
                }
                
                this.processMessage(data);
            } catch (error) {
                console.error('Error processing message:', error);
            }
        };

        this.socket.onclose = () => {
            log('Error: The server connection has been disconnected, the request cannot be processed.');
            this.dom.innerHTML = '<div style="color: red;">API Disconnected!</div>';

            setTimeout(() => {
                log('Attempting to reconnect...');
                this.connect();
            }, 2000);
        };

        this.socket.onerror = (error) => {
            log('Error: Server connection error, please check the server.', error);
            this.dom.innerHTML = '<div style="color: red;">API Error!</div>';
        };
    }

    processMessage(data) {
        try {
            const message = JSON.parse(data);
            
            if (message.type === 'request') {
                log('Received request from server:', message.data);
                this.start(message.data);
            }
        } catch (error) {
            console.error('Error parsing message JSON:', error);
        }
    }

    init() {
        window.addEventListener('load', () => {
            this.dom = document.createElement('div');
            this.dom.style =
                'position: fixed; top: 10px; right: 10px; z-index: 9999; display: flex; justify-content: center; align-items: center;';
            document.body.appendChild(this.dom);

            this.connect();

            setInterval(() => this.sendHeartbeat(), 30000);
        });
    }
}

(function () {
    'use strict';
    const app = new App();
    app.init();
})();
