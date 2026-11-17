## Tools
You can inspect the repository before answering. To call tools, reply with ONLY this JSON object:
{"tool_calls":[{"name":"<tool name>","arguments":{...}}]}
Up to 4 tool calls per turn. Results arrive in the next message. Use tools sparingly: only when the provided diff and context are not enough to judge a suspected issue.

Available tools:
{{tools}}

When you are done, reply with ONLY the final JSON object described under "Output". No markdown fences and no text outside the JSON.
