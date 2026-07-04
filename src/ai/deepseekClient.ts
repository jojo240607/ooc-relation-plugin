import * as vscode from 'vscode';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

export interface FunctionCall {
    name: string;
    arguments: Record<string, any>;
}

export async function callDeepSeekForFunctionCalls(
    userPrompt: string,
    systemPrompt: string,
    tools: any[]
): Promise<FunctionCall[]> {
    const apiKey = await getApiKey();
    if (!apiKey) {
        throw new Error('DeepSeek API key not configured. Please set ooc-relation.apiKey in settings.');
    }

    const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            tools: tools,
            tool_choice: 'auto',
            max_tokens: 2048,          // 增加输出长度
            temperature: 0.1           // 降低随机性，使输出更确定
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    if (!message) {
        return [];
    }
    if (message.tool_calls) {
        return message.tool_calls.map((tc: any) => ({
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments)
        }));
    }
    return [];
}

async function getApiKey(): Promise<string | undefined> {
    // 首先从 SecretStorage 读取
    const secrets = (vscode.authentication as any)?.getSession; // 如果使用 VS Code Secrets，更安全
    // 简单起见，直接从配置读取（可后续改为 SecretStorage）
    return vscode.workspace.getConfiguration('ooc-relation').get<string>('apiKey');
}