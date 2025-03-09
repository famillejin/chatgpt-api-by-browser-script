# Project Brief
This project will transform the GUI version of ChatGPT into a openai API compatible server for simple AI testing and development purposes.
It avoids the cost of using the official openai APIs.
## Project Goals
- [x] Define the core requirements and goals of the project.
A TamperMonkey and a CSP disabler extensions are installed on Chrome
TamperMonkey allows the user to inject code into web pages, which is useful for this project. The script will be injected into the ChatGPT website.
CSP (Content Security Policy) disabler extension disables the Content Security Policy of the website, allowing the TamperMonkey script to proxy API between the ChatGPT page and a local running node server, through the websocket protocol

- [x] Establish the project scope.
A local nodejs server runs the indes.js script and starts a webserver to listen to API calls. The API is compatible with OpenAI APIs.
When a calls comes from an API client, the call is forwarded to the TamperMonkey script through websocket protocol.
TamperMonkey injects the chat instructions through the chat input field of the ChatGPT page.
Then it monitors the response and extracts the LLM's answer when typical end of answer UI items appear on the page.
The extracted answer is then cleaned to a string, which is sent back to the nodejs server through the websocket protocol, then the API client gets the answer from the nodejs server.
- [x] Maintain the memory bank.

## Core Requirements
- [x] Maintain the memory bank.
- [ ] Each time a code file is edited, increase the version and build number of the project and make sure it's displayed in debug console.

## Project Scope
