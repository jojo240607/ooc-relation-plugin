import * as vscode from 'vscode';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

export interface FunctionCall {
    name: string;
    arguments: Record<string, any>;
}

export async function callDeepSeekForFunctionCalls(
    messages: { role: string; content: string; tool_calls?: any[]; tool_call_id?: string }[],
    tools: any[],
    requireTool: boolean = false
): Promise<FunctionCall[]> {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('API key not configured.');

    const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: messages,
            tools: tools,
            tool_choice: requireTool ? 'required' : 'auto',
            max_tokens: 4096
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    if (!message) return [];
    if (message.tool_calls) {
        return message.tool_calls.map((tc: any) => ({
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments)
        }));
    }
    return [];
}

async function getApiKey(): Promise<string | undefined> {
    return vscode.workspace.getConfiguration('ooc-relation').get<string>('apiKey');
}