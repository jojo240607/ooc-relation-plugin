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

        const systemPrompt = `You are an OOC code generation assistant. Plan and execute user requests step by step. In each response, you may return a JSON array of one or more function calls to perform the next actions. After each set of actions, you will receive the results, and you can then decide the next steps. When the task is completely finished, return an empty JSON array [] to indicate completion.

Available functions:
- create_base_class(className, folderUri)
- create_interface(interfaceName, folderUri, methods)
- create_subclass(parentName, parentHeaderPath, subclassName)
- add_virtual_methods(className, headerPath, methods)
- override_method(className, headerPath, fromClass, method, vtablePath)
- add_members(className, headerPath, members)
- add_regular_methods(className, headerPath, methods)

Current context: ${contextInfo}`;

        // 构建对话历史
        const messages: any[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userInput }
        ];

        let allResults: string[] = [];
        const maxSteps = 10;
        let step = 0;

        while (step < maxSteps) {
            console.log(`[Chat] Step ${step + 1}...`);
            let calls: FunctionCall[] = [];
            try {
                calls = await callDeepSeekForFunctionCalls(messages, OOC_TOOLS, step === 0); // 第一步强制使用工具
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

            // 将 assistant 的 tool_calls 和 tool 执行结果追加到消息历史
            const assistantMsg: any = { role: 'assistant', content: null, tool_calls: calls.map(c => ({
                id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.arguments) }
            })) };
            messages.push(assistantMsg);

            // 为每个调用添加 tool 角色消息
            for (let i = 0; i < results.length; i++) {
                messages.push({
                    role: 'tool',
                    tool_call_id: assistantMsg.tool_calls[i].id,
                    content: results[i]
                });
            }
            step++;
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