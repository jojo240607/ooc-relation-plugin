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

        const systemPrompt = `你是一个 OOC（面向对象 C）代码生成助手。请逐步规划并执行用户的请求。每次响应必须返回一个 JSON 数组，其中包含一个或多个函数调用。执行后你会收到结果，然后可以决定下一步操作。当任务完全完成时，返回一个空数组 []。

可用工具：
- create_base_class(className, folderUri) —— 创建基类
- create_interface(interfaceName, folderUri, methods) —— 创建接口
- create_subclass(parentName, parentHeaderPath, subclassName) —— 创建子类
- add_virtual_methods(className, headerPath, methods) —— 添加虚函数（自动处理虚表）
- override_method(className, headerPath, fromClass, method, vtablePath) —— 重写一个继承的虚函数
- add_members(className, headerPath, members) —— 添加成员变量
- add_regular_methods(className, headerPath, methods) —— 添加常规方法（Fun 表）
- modify_function_body(headerPath, functionName, codeContent, mode) —— 修改函数体，mode 为 "replace" 或 "append"
- add_private_function(headerPath, returnType, funcName, params, body) —— 添加静态私有函数
- add_global_variable(headerPath, type, name, initialValue?) —— 添加全局变量
- add_include(headerPath, includePath) —— 添加 #include
- read_source_file(headerPath) —— 读取当前 .c 文件内容

## 强制执行顺序
1. **对于虚方法或常规方法（Fun 表）**：你必须先使用 add_virtual_methods 或 add_regular_methods 声明方法。只有在此之后，才能使用 modify_function_body 并选择 mode "replace" 来实现其函数体。
2. **对于私有/辅助函数**：直接使用 add_private_function。它会在文件末尾定义完整的函数（声明+函数体），并自动在文件顶部添加前向声明。不要对这些函数使用 modify_function_body。
3. **对于重写方法**：使用 override_method 之后，函数已被声明并实现（带有 TODO）。请使用 modify_function_body 并选择 mode "replace" 来提供真正的实现。
4. **对于 init/deinit 函数**：它们已经作为模板存在。只能使用 modify_function_body 并选择 mode "append" 在末尾添加额外代码。

## 规则
- 绝对不要修改一个函数的函数体，除非你已经确认该函数存在（通过 read_source_file 或在同一计划的先前步骤中刚刚创建）。
- 如果某个函数不存在而你需要实现它，请先使用合适的工具创建它。
- 创建重写时，先使用 override_method，然后再实现其函数体。
- 在继续之前，始终检查前一步的结果。
- 不要添加重复的函数。
- 对于私有函数，add_private_function 会自动处理前向声明。
- 在使用 mode "replace" 调用 modify_function_body 之前，务必先通过 read_source_file 读取源文件，以确认确切的函数名和签名存在。
- 如果不确定函数名，请使用 add_private_function 来创建它，而不是修改一个可能不存在的函数。
- 绝不要在未验证函数存在于文件中的情况下尝试替换函数体。
- 调用 modify_function_body 时，确保 functionName 参数前后没有多余的空格。

## 强制性完整性规则
- 对于用户的复合请求，你必须一次性返回**所有**必需的函数调用，不得遗漏任何步骤。
- 当请求中包含“重写”或“override”时，你必须在计划中明确调用 override_method。
- 当请求中包含“常规方法”或“add regular method”时，你必须在计划中调用 add_regular_methods。
- 即使某些步骤可能已经完成（例如类已存在），你仍然需要生成对应的调用（这些调用会被自动跳过而不会出错）。
- 请参考下面的完整示例。

## 完整示例（包含所有常见操作）
用户请求："创建一个基类 Animal，包含虚函数 speak 和 eat。然后创建一个接口 IAnimal，包含虚函数 move。再创建 Animal 的子类 Dog，重写 speak 方法，添加一个常规方法 run（无额外参数），并为 Dog 添加成员变量 age 和 name。"

你的计划应该包含以下全部调用（顺序可能略有不同）：
1. create_base_class Animal
2. add_virtual_methods Animal (speak, eat)
3. create_interface IAnimal (move)
4. create_subclass Dog 继承 Animal
5. override_method Dog 重写 speak
6. add_regular_methods Dog (run)
7. add_members Dog (age, name)

请严格遵守此完整性要求。
当前上下文：${contextInfo}`;

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