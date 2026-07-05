import * as vscode from 'vscode';
import { callDeepSeekForFunctionCalls, FunctionCall } from './ai/deepseekClient';
import { OOC_TOOLS } from './ai/tools';
import { executeFunctionCalls } from './ai/agentExecutor';
import { relationStore } from './sync/ClassRelationStore';

export function activateChatParticipant(context: vscode.ExtensionContext) {
    console.log('[Chat] Activating chat participant...');

    let lastPrompt = '';
    let lastTime = 0;

    const participant = vscode.chat.createChatParticipant('ooc-ai-agent', async (request, chatContext, stream, token) => {
        const userInput = request.prompt;
        if (userInput === lastPrompt && Date.now() - lastTime < 1000) {
            console.log('[Chat] Duplicate request ignored');
            return;
        }
        lastPrompt = userInput;
        lastTime = Date.now();

        console.log('[Chat] Request received:', userInput);
        if (!userInput) {
            stream.markdown('Please describe the OOC classes you want to create.');
            return;
        }

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        let existingClassesInfo = '';
        try {
            const classNames = relationStore.getAllClassNames();
            existingClassesInfo = classNames.map(name => {
                const entry = relationStore.getClass(name);
                const path = entry ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, entry.file).fsPath : `${name}.h`;
                return `${name} -> ${path}`;
            }).join('\n');
        } catch (err) {
            console.error('[Chat] Failed to get existing classes:', err);
        }

        const contextInfo = `Workspace root: ${workspaceRoot}\nExisting classes:\n${existingClassesInfo || 'none'}`;

        const systemPrompt = `You are an OOC code generation assistant. Plan and execute user requests step by step. Each response must be a JSON array of function calls. After executing, you will receive results and can plan next steps. When finished, return [].

Available tools:
- create_base_class(className, folderUri)
- create_interface(interfaceName, folderUri, methods)
- create_subclass(parentName, parentHeaderPath, subclassName)
- add_virtual_methods(className, headerPath, methods)
- override_method(className, headerPath, fromClass, method, vtablePath)
- add_members(className, headerPath, members)
- add_regular_methods(className, headerPath, methods)
- modify_function_body(headerPath, functionName, codeContent, mode)  // mode: "replace" or "append"
- add_private_function(headerPath, returnType, funcName, params, body)
- add_global_variable(headerPath, type, name, initialValue?)
- add_include(headerPath, includePath)
- read_source_file(headerPath)   // returns current .c file content

## MANDATORY EXECUTION ORDER
1. **For virtual methods or regular (Fun) methods:** You MUST first declare the method using \`add_virtual_methods\` or \`add_regular_methods\`. Only AFTER that, you can implement its body using \`modify_function_body\` with mode "replace".
2. **For private/helper functions:** Use \`add_private_function\` directly. This will define the entire function (declaration + body) at the end of the file. It will also automatically add a forward declaration at the top. Do NOT use \`modify_function_body\` on these.
3. **For override methods:** After using \`override_method\`, the function is already declared and implemented (with TODO). Use \`modify_function_body\` with mode "replace" to provide the real implementation.
4. **For init/deinit:** These already exist as templates. Only use \`modify_function_body\` with mode "append" to add extra code at the end.

## RULES
- NEVER attempt to modify a function's body unless you have confirmed it exists (via \`read_source_file\` or by having just created it in a previous step of the same plan).
- If a function does not exist and you need to implement it, create it first using the appropriate tool.
- When creating overrides, use \`override_method\` first, then implement.
- Always check the results of previous steps before proceeding.
- Do not add duplicate functions.
- For private functions, \`add_private_function\` handles the forward declaration automatically.
- Before calling modify_function_body with mode "replace", ALWAYS read the source file first to confirm the exact function name and signature exist.
- If you are unsure about the function name, use add_private_function to create it instead.
- Never attempt to replace a function body if you haven't verified its existence in the file.

Current context: ${contextInfo}`;

        const messages: any[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userInput }
        ];

        let allResults: string[] = [];
        const maxSteps = 10;

        for (let step = 0; step < maxSteps; step++) {
            console.log(`[Chat] Step ${step + 1}...`);
            let calls: FunctionCall[] = [];
            try {
                calls = await callDeepSeekForFunctionCalls(messages, OOC_TOOLS, step === 0);
            } catch (err: any) {
                console.error('[Chat] API error:', err);
                allResults.push(`❌ API Error: ${err.message}`);
                break;
            }

            if (calls.length === 0) {
                console.log('[Chat] No more calls, task complete.');
                break;
            }

            console.log('[Chat] Received calls:', JSON.stringify(calls, null, 2));
            const results = await executeFunctionCalls(calls);
            allResults.push(...results);

            // 等待文件系统刷新
            await new Promise(resolve => setTimeout(resolve, 500));

            const assistantMsg: any = {
                role: 'assistant',
                content: null,
                tool_calls: calls.map(c => ({
                    id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    type: 'function',
                    function: { name: c.name, arguments: JSON.stringify(c.arguments) }
                }))
            };
            messages.push(assistantMsg);

            for (let i = 0; i < results.length; i++) {
                messages.push({
                    role: 'tool',
                    tool_call_id: assistantMsg.tool_calls[i].id,
                    content: results[i]
                });
            }
        }

        if (allResults.length === 0) {
            stream.markdown('No actions were executed.');
        } else {
            stream.markdown('### Results:\n' + allResults.join('\n'));
        }
    });

    context.subscriptions.push(participant);
    console.log('[Chat] Participant registered and added to subscriptions.');
}