// ==UserScript==
// @name         ChatGPT API By Browser Script
// @namespace    http://tampermonkey.net/
// @version      15
// @match        https://chatgpt.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=openai.com
// @grant        GM_webRequest
// @license MIT
// ==/UserScript==

const log = (...args) => {
    console.log('chatgpt-api-by-browser-script', ...args);
}
log('starting');

const WS_URL = `ws://localhost:8765`;

function cleanText(inputText) {
    const invisibleCharsRegex = /[\u200B\u200C\u200D\uFEFF]|[\u0000-\u001F\u007F-\u009F]/g;
    const cleanedText = inputText.replace(invisibleCharsRegex, '');
    return cleanedText;
}

function getTextFromNode(node) {
    let result = '';
    if (!node) return result;

    if (node.classList.contains('invisible')) {
        return result;
    }

    const childNodes = node.childNodes;
    for (let i = 0; i < childNodes.length; i++) {
        let childNode = childNodes[i];
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
    return function() {
        const context = this, args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

function sanitizeTextForWebSocket(text) {
  if (!text) return text;

  return text
    // Remove common control characters (0x00-0x1F except for \t, \n, \r)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')

    // Remove zero-width characters
    .replace(/[\u200B-\u200D\uFEFF]/g, '')

    // Remove directional formatting characters
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')

    // Remove other potentially problematic Unicode control characters
    .replace(/[\u2028\u2029\u0085]/g, '')

    // Remove deletion characters
    .replace(/[\u007F\u2421]/g, '')

    // Remove other special whitespace characters that aren't standard spaces
    .replace(/[\u00A0\u1680\u180E\u2000-\u200A\u202F\u205F\u3000]/g, ' ')

    // Optional: Replace backspace characters which can "delete" previous characters
    .replace(/[\u0008]/g, '');
}

class App {
    constructor() {
        this.socket = null;
        this.observer = null;
        this.stop = false;
        this.dom = null;
        this.lastText = null;
    }

    async start({ text, model, newChat }) {
        this.stop = false;
        log('Starting to send a message');

        const textarea = document.querySelector('div[contenteditable="true"]');
        if (textarea) {
            textarea.focus();
            textarea.textContent = text;
            textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));

            // Wait for the send button to appear
            await sleep(500); // Adjust the delay if needed

            const sendButton = document.querySelector('button[aria-label="Send prompt"]');
            if (sendButton) {
                sendButton.click();
                this.observeMutations();
            } else {
                log('Error: Send button not found');
            }
        } else {
            log('Error: Textarea not found');
        }
    }

    async observeMutations() {
        let lastScrollDownClick = 0;
        let checkForCopyTimeout = null;

        this.observer = new MutationObserver(async (mutations) => {
            // Check for the scroll down button
            const scrollDownButton = document.querySelector('button.cursor-pointer.absolute.z-10.rounded-full.bg-clip-padding.border.text-token-text-secondary.border-token-border-light.right-1\\/2.translate-x-1\\/2.bg-token-main-surface-primary.w-8.h-8.flex.items-center.justify-center.bottom-5');
            if (scrollDownButton) {
                const now = Date.now();
                if (now - lastScrollDownClick > 100) {
                    console.log("Clicking scroll down button");
                    scrollDownButton.click();
                    lastScrollDownClick = now;

                    clearTimeout(checkForCopyTimeout);

                    // Wait 200ms and check if the button is still visible
                    await sleep(200);
                    const scrollDownButtonStillVisible = document.querySelector('button.cursor-pointer.absolute.z-10.rounded-full.bg-clip-padding.border.text-token-text-secondary.border-token-border-light.right-1\\/2.translate-x-1\\/2.bg-token-main-surface-primary.w-8.h-8.flex.items-center.justify-center.bottom-5');
                    if (scrollDownButtonStillVisible) {
                        scrollDownButton.click();
                    }
                }
            } else {
                // Debounce the checkForCopyButton call
                checkForCopyTimeout = setTimeout(debounce(() => {
                    this.checkForCopyButton();
                }, 300), 300);
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
        console.log("checkForCopyButton called");
        const copyButton = document.querySelector('button[data-testid="copy-turn-action-button"]');
        if (copyButton) {
            console.log("Copy button appeared");

            try {
                // Extract the full HTML content from the relevant message container which is the last instance of conversation-turn class on the page
                const messageContainers = document.querySelectorAll('.group\\/conversation-turn');
                let messageContainer = messageContainers[messageContainers.length - 1];
                if (messageContainer) {
                    //work on a copy of the message container, do not modify the original
                    messageContainer = messageContainer.cloneNode(true);
                    // Get all code blocks
                    const codeBlocks = messageContainer.querySelectorAll('code');
                    const codeBlocksArray = Array.from(codeBlocks);

                    // Replace code blocks with markers
                    codeBlocksArray.forEach((block, index) => {
                        block.dataset.originalContent = block.innerHTML;
                        block.innerHTML = `[CODE_BLOCK_${index}]`;
                    });

                    // Extract the text content from the message container
                    let textContent = getTextFromNode(messageContainer);

                    // Restore code blocks content
                    // format the content so LLM UI can interprets it correctly as code block
                    codeBlocksArray.forEach((block, index) => {
                        const decoder = new DOMParser().parseFromString(block.dataset.originalContent ?? '', 'text/html');
                        const decodedContent = decoder.documentElement.textContent;
                        textContent = textContent.replace(`[CODE_BLOCK_${index}]`, "\n```\n" + decodedContent + "```\n");
                    });

                    console.log("Extracted text:", textContent);

                    //const cleanedText = sanitizeTextForWebSocket(textContent.replace(/[\x00-\x1F\x7F-\x9F]/g, ''));

                    const cleanedText = sanitizeTextForWebSocket(textContent);
                    console.log("Sending text with length:", cleanedText.length);
                    console.log("Sending cleaned texst:", cleanedText);


                    const encoder = new TextEncoder();
                    const payload = JSON.stringify({
                        type: 'answer',
                        text: cleanedText+' '.repeat(1500),
                    });
                    const binaryData = encoder.encode(payload);
                    this.socket.send(binaryData);

/*
                    // Send the message to the server
                    // Ensure text is properly encoded
                    const jsonObj = {
                        type: 'answer',
                        text: cleanedText,
                        length: cleanedText.length
                    };

                    // Convert to properly escaped JSON string with UTF-8 handling
                    const jsonString = JSON.stringify(jsonObj, (key, value) => {
                        if (typeof value === 'string') {
                            // Explicitly handle problematic Unicode sequences
                            return value.replace(/[\uD800-\uDFFF]/g, (char) => {
                                return '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0');
                            });
                        }
                        return value;
                    });
                    // Send the properly escaped string
                    this.socket.send(jsonString);
*/
                    /*
                    this.socket.send(
                        JSON.stringify({
                            type: 'answer',
                            text: cleanedText,
                            length: cleanedText.length
                        })
                    );
*/

                    //send the message in chunks
                    //this.sendInChunks(textContent);

                }

                this.observer.disconnect();
                this.stop = true;
                this.socket.send(
                    JSON.stringify({
                        type: 'stop',
                    })
                );
            } catch (error) {
                console.error("Error in checkForCopyButton:", error);
            }
        }
    }

    sendInChunks(message) {
        const chunkSize = 1024; // Adjust the chunk size as needed
        //pour une raison inconnue, parfois il manque un bout de texte
        //on va donc générer un texte de 1024 caractères à ajouter à la fin du message
        //pour s'assurer que le message est bien complet
        const paddingLength = 0;
        const paddedMessage = message + ' '.repeat(paddingLength);
        console.log("paddedMessage=", paddedMessage);
        for (let i = 0; i < paddedMessage.length; i += chunkSize) {
            const chunk = paddedMessage.slice(i, i + chunkSize);
            console.log("chunk=", chunk);

            //send the chunk to server
            this.socket.send(
                JSON.stringify({
                    type: 'answer',
                    text: chunk
                })
            );
        }
    }

    sendHeartbeat() {
        if (this.socket.readyState === WebSocket.OPEN) {
            log('Sending heartbeat');
            this.socket.send(JSON.stringify({ type: 'heartbeat' }));
        }
    }

    connect() {
        this.socket = new WebSocket(WS_URL);
        this.socket.onopen = () => {
            log('Server connected, can process requests now.');
            this.dom.innerHTML = '<div style="color: green;">API Connected!</div>';
        };
        this.socket.onclose = () => {
            log(
                'Error: The server connection has been disconnected, the request cannot be processed.'
            );
            this.dom.innerHTML = '<div style="color: red;">API Disconnected!</div>';

            setTimeout(() => {
                log('Attempting to reconnect...');
                this.connect();
            }, 2000);
        };
        this.socket.onerror = (error) => {
            log(
                'Error: Server connection error, please check the server.',
                error
            );
            this.dom.innerHTML = '<div style="color: red;">API Error!</div>';
        };
        this.socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                log('Received data from server', data);
                this.start(data);
            } catch (error) {
                log('Error: Failed to parse server message', error);
            }
        };
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