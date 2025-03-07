// ==UserScript==
// @name         ChatGPT API By Browser Script
// @namespace    http://tampermonkey.net/
// @version      16
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
        console.log("checkForCopyButton called - v16");
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
                        textContent = textContent.replace(`[CODE_BLOCK_${index}]`, decodedContent);
                    });

                    // Split text into code and non-code parts
                    const codeParts = [];
                    const nonCodeParts = [];
                    let currentText = textContent;
                    
                    // Extract all code blocks
                    const codeBlockRegex = /```[\s\S]*?```/g;
                    let match;
                    let lastIndex = 0;
                    
                    while ((match = codeBlockRegex.exec(textContent)) !== null) {
                        // Add text before code block
                        if (match.index > lastIndex) {
                            nonCodeParts.push(textContent.slice(lastIndex, match.index).trim());
                        }
                        // Add code block
                        codeParts.push(match[0]);
                        lastIndex = match.index + match[0].length;
                    }
                    
                    // Add remaining text after last code block
                    if (lastIndex < textContent.length) {
                        nonCodeParts.push(textContent.slice(lastIndex).trim());
                    }

                    // Combine parts with clear separation
                    const formattedText = [];
                    if (nonCodeParts.length > 0) {
                        formattedText.push(nonCodeParts.join('\n\n'));
                    }
                    if (codeParts.length > 0) {
                        formattedText.push(codeParts.join('\n\n'));
                    }

                    textContent = formattedText.join('\n\n');
                    console.log("Extracted and formatted text:", textContent);

                    // Split text into chunks and send with checksums
                    const chunkSize = 256;
                    const chunks = [];
                    for (let i = 0; i < textContent.length; i += chunkSize) {
                        const chunk = textContent.slice(i, i + chunkSize);
                        chunks.push({ chunk });
                    }

                    // Send chunks with retry logic
                    for (let i = 0; i < chunks.length; i++) {
                        let retries = 0;
                        let success = false;
                        
                        while (retries < 5 && !success) {
                            // Calculate complete message checksum
                            const completeSha256 = await this.calculateSHA256(textContent);
                            
                            const payload = JSON.stringify({
                                type: 'chunk',
                                index: i,
                                total: chunks.length,
                                data: chunks[i].chunk,
                                completeSha256: completeSha256
                            });
                            this.socket.send(payload);

                            // Wait for acknowledgment
                            const ack = await this.waitForAck(i);
                            if (ack === 'success') {
                                success = true;
                            } else {
                                retries++;
                                console.log(`Retrying chunk ${i}, attempt ${retries}`);
                            }
                        }

                        if (!success) {
                            throw new Error(`Failed to send chunk ${i} after 5 retries`);
                        }
                    }

                    // Send final stop message
                    this.socket.send(JSON.stringify({
                        type: 'stop'
                    }));
                }

                this.observer.disconnect();
                this.stop = true;
            } catch (error) {
                console.error("Error in checkForCopyButton:", error);
            }
        }
    }

    async calculateSHA256(str) {
        const buffer = new TextEncoder().encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    waitForAck(index) {
        return new Promise((resolve) => {
            const handler = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'ack' && message.index === index) {
                        this.socket.removeEventListener('message', handler);
                        resolve(message.status);
                    }
                } catch (error) {
                    // Ignore parsing errors
                }
            };
            this.socket.addEventListener('message', handler);
        });
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
        
        this.socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                
                if (message.type === 'request') {
                    log('Received request from server:', message.data);
                    this.start(message.data);
                }
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
