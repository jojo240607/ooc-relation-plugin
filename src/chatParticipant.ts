import * as vscode from 'vscode';
import { callDeepSeekForFunctionCalls } from './ai/deepseekClient';
import { OOC_TOOLS } from './ai/tools';
import { executeFunctionCalls } from './ai/agentExecutor';
import { relationStore } from './sync/ClassRelationStore';

export function activateChatParticipant(context: vscode.ExtensionContext) {
    console.log('[Chat] Activating chat participant...');

    const participant = vscode.chat.createChatParticipant('ooc-ai-agent', async (request, chatContext, stream, token) => {
        console.log('[Chat] Request received:', request.prompt);

        const userInput = request.prompt;
        if (!userInput) {
            console.log('[Chat] Empty prompt, exiting.');
            stream.markdown('Please describe the OOC classes you want to create.');
            return;
        }

        // 获取工作区上下文
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        let existingClassesInfo = '';
        try {
            const classNames = relationStore.getAllClassNames();
            existingClassesInfo = classNames.map(name => {
                const entry = relationStore.getClass(name);
                const path = entry ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, entry.file).fsPath : `${name}.h`;
                return `${name} -> ${path}`;
            }).join('\n');
            console.log('[Chat] Existing classes:\n', existingClassesInfo);
        } catch (err) {
            console.error('[Chat] Failed to get existing classes:', err);
        }

        const contextInfo = `Current workspace root: ${workspaceRoot}\n` +
            `Existing classes (name -> full header path):\n${existingClassesInfo || 'none'}\n` +
            `When calling tools, always provide the full absolute header path. If you don't know it, use the path listed above. If the class is not listed, assume it's in the workspace root as {className}.h.`;

        const systemPrompt = `
You are an AI assistant that generates Object-Oriented C (OOC) code using predefined tools. 
You must ONLY respond with function calls to the provided tools. 
Rules:
- Use the tool names exactly as defined.
- Pass all required arguments as specified.
- If a folder path or header path is needed, prefer using the workspace root provided in the user prompt.
- When creating a subclass, make sure the parent class exists (create it first if not).
- Order calls logically (e.g., create base class before adding methods, create class before overriding).
- **IMPORTANT: Always return ALL necessary function calls in one single response. Do not stop until the user's request is fully satisfied.** 
- Do not output any text outside the function calls.
- For any existing class, use the exact header path provided in the context.

${contextInfo}

Example:
User: "Create a base class Animal with virtual method speak, then create a subclass Dog that overrides speak."
You should return:
[
  {"name": "create_base_class", "arguments": {"className": "Animal", "folderUri": "/workspace"}},
  {"name": "add_virtual_methods", "arguments": {"className": "Animal", "headerPath": "/workspace/Animal.h", "methods": [{"returnType": "void", "name": "speak", "params": "Animal *self"}]}},
  {"name": "create_subclass", "arguments": {"parentName": "Animal", "parentHeaderPath": "/workspace/Animal.h", "subclassName": "Dog"}},
  {"name": "override_method", "arguments": {"className": "Dog", "headerPath": "/workspace/Dog.h", "fromClass": "Animal", "method": {"returnType": "void", "name": "speak", "params": "Animal *self"}, "vtablePath": "parent.vtable"}}
]
`;

        const userPrompt = `User request: ${userInput}\n${contextInfo}`;

        try {
            console.log('[Chat] Sending request to DeepSeek...');
            const calls = await callDeepSeekForFunctionCalls(userPrompt, systemPrompt, OOC_TOOLS);
            console.log('[Chat] Received function calls:', JSON.stringify(calls, null, 2));

            if (calls.length === 0) {
                stream.markdown('No actions required.');
                return;
            }

            stream.markdown('### Planned Actions:\n' + calls.map(c => `- ${c.name}`).join('\n'));
            console.log('[Chat] Executing function calls...');
            const results = await executeFunctionCalls(calls);
            console.log('[Chat] Execution results:', results);

            stream.markdown('### Results:\n' + results.join('\n'));
        } catch (err: any) {
            console.error('[Chat] Error:', err);
            stream.markdown(`Error: ${err.message}`);
        }
    });

    context.subscriptions.push(participant);
    console.log('[Chat] Participant registered and added to subscriptions.');
}