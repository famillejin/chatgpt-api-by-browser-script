# System Patterns

## System Architecture
- Tampermonkey script
- CSP disabler extension
- Local Node.js server

## Key Technical Decisions
- Use Tampermonkey to inject code into the ChatGPT website.
- Use a local Node.js server to handle API calls.

## Design Patterns in Use
- Proxy
- Observer

## Component Relationships
- The Tampermonkey script injects chat instructions into the ChatGPT page, monitors the response, and extracts the LLM's answer.
- The extracted answer is then sent back to the Node.js server, which then sends the answer to the API client.
