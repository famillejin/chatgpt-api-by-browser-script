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
          // Alternative method 1: Get text directly from response elements
          const responseElements = document.querySelectorAll('.markdown');
          const responses = Array.from(responseElements).map(el => getTextFromNode(el)).filter(text => text.trim() !== '');

          if (responses.length > 0) {
              const lastResponse = responses[responses.length - 1];
              console.log("Extracted response:", lastResponse);

              this.lastText = lastResponse;
              this.socket.send(
                  JSON.stringify({
                      type: 'answer',
                      text: lastResponse,
                  })
              );

              this.observer.disconnect();

              if (!this.stop) {
                  this.stop = true;
                  this.socket.send(
                      JSON.stringify({
                          type: 'stop',
                      })
                  );
              }
              return;
          }

          // Alternative method 2: Try clipboard with explicit error handling
          try {
              copyButton.click();
              await sleep(500);

              const clipboardText = await navigator.clipboard.readText();
              console.log("Clipboard content:", clipboardText);

              this.socket.send(
                  JSON.stringify({
                      type: 'answer',
                      text: clipboardText,
                  })
              );
          } catch (clipboardError) {
              console.error("Clipboard access failed:", clipboardError);

              // Alternative method 3: Use window selection
              const selectedText = window.getSelection().toString();
              if (selectedText) {
                  console.log("Selected text:", selectedText);
                  this.socket.send(
                      JSON.stringify({
                          type: 'answer',
                          text: selectedText,
                      })
                  );
              }
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