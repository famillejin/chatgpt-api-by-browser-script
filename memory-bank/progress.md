# Progress

## What Works
- Basic setup of the project, including the Tampermonkey script, CSP disabler extension, and local Node.js server.

## What's Left to Build
- Full OpenAI API compatibility, including all the different API endpoints and parameters.

## Current Status
- The memory bank has been initialized and is being updated.

## Known Issues
- For unknown reasons, when the content is extracted on the TamperMonkey side, it has the expected content but once it's sent through websocket, the content received on the nodejs webssocker server side will have different length. The beginning and the end of the content is correct, but some portion before the end of the content is missing. This triggers corrupted JSON syntax and is making our OpenBrains project fail to work.
