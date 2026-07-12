import * as vscode from 'vscode';

export interface FunctionCall {
    name: string;
    arguments: Record<string, any>;
}

export interface FunctionCallResult {
    calls: FunctionCall[];
    assistantMessage: any;
}

export interface StreamChunk {
    type: 'content' | 'reasoning';
    text: string;
}

interface AIConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    thinkingEnabled: boolean;
    reasoningEffort: string;
    maxTokens: number;
    temperature: number;
}

async function getAIConfig(): Promise<AIConfig> {
    const config = vscode.workspace.getConfiguration('ooc-relation');
    const provider = config.get<string>('aiProvider', 'deepseek');

    let apiKey: string | undefined;
    let baseUrl: string;
    let defaultModel: string;

    if (provider === 'hy3') {
        apiKey = config.get<string>('hy3apiKey');
        baseUrl = 'https://tokenhub.tencentmaas.com/v1/chat/completions';
        defaultModel = 'hy3';
    } else {
        apiKey = config.get<string>('apiKey');
        baseUrl = 'https://api.deepseek.com/chat/completions';
        defaultModel =  config.get<string>('model', 'deepseek-v4-flash');//'deepseek-v4-flash';
    }

    if (!apiKey) {
        const keySetting = provider === 'hy3' ? 'ooc-relation.hy3apiKey' : 'ooc-relation.apiKey';
        const action = await vscode.window.showErrorMessage(
            `${provider} API Key 未配置，请在设置中填写 ${keySetting}`,
            '打开设置'
        );
        if (action === '打开设置') {
            vscode.commands.executeCommand('workbench.action.openSettings', keySetting);
        }
        throw new Error('API key not configured.');
    }
    //console.log("------------ use ai provider: " + provider);
    return {
        baseUrl,
        apiKey,
        model: config.get<string>('model', defaultModel),
        thinkingEnabled: config.get<boolean>('thinkingEnabled', true),
        reasoningEffort: config.get<string>('reasoningEffort', 'high'),
        maxTokens: config.get<number>('maxTokens', 4096),
        temperature: config.get<number>('temperature', 0.7),
    };
}

// 公共请求头
function buildHeaders(apiKey: string) {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
    };
}

// 非流式 Function Calling
export async function callAIForFunctionCalls(
    messages: any[],
    tools: any[],
    requireTool: boolean = false
): Promise<FunctionCallResult> {
    const cfg = await getAIConfig();
    const thinkingType = cfg.thinkingEnabled ? "enabled" : "disabled";

    const response = await fetch(cfg.baseUrl, {
        method: 'POST',
        headers: buildHeaders(cfg.apiKey),
        body: JSON.stringify({
            model: cfg.model,
            messages,
            thinking: { type: thinkingType },
            reasoning_effort: cfg.reasoningEffort,
            stream: false,
            tools,
            tool_choice: 'auto',
            max_tokens: cfg.maxTokens,
            temperature: cfg.temperature,
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const msg = data.choices?.[0]?.message;
    if (!msg) return { calls: [], assistantMessage: null };

    const assistantMessage: any = {
        role: msg.role,
        content: msg.content,
        tool_calls: msg.tool_calls,
    };
    if (msg.reasoning_content) {
        assistantMessage.reasoning_content = msg.reasoning_content;
    }

    const calls = msg.tool_calls?.map((tc: any) => ({
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
    })) || [];

    return { calls, assistantMessage };
}

// 非流式纯文本
export async function callAIForText(messages: any[]): Promise<string> {
    const cfg = await getAIConfig();
    const thinkingType = cfg.thinkingEnabled ? "enabled" : "disabled";

    const response = await fetch(cfg.baseUrl, {
        method: 'POST',
        headers: buildHeaders(cfg.apiKey),
        body: JSON.stringify({
            model: cfg.model,
            messages,
            thinking: { type: thinkingType },
            reasoning_effort: cfg.reasoningEffort,
            stream: false,
            tool_choice: 'none',
            tools: [],
            max_tokens: cfg.maxTokens,
            temperature: cfg.temperature,
        }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
}

// 流式文本（含 reasoning）
export async function* streamAIForText(messages: any[]): AsyncGenerator<StreamChunk, void, undefined> {
    const cfg = await getAIConfig();
    const thinkingType = cfg.thinkingEnabled ? "enabled" : "disabled";

    const response = await fetch(cfg.baseUrl, {
        method: 'POST',
        headers: buildHeaders(cfg.apiKey),
        body: JSON.stringify({
            model: cfg.model,
            messages,
            stream: true,
            thinking: { type: thinkingType },
            reasoning_effort: cfg.reasoningEffort,
            tool_choice: 'none',
            tools: [],
            max_tokens: cfg.maxTokens,
            temperature: cfg.temperature,
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI stream error (${response.status}): ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;
                const dataStr = trimmed.slice(6);
                if (dataStr === '[DONE]') return;

                try {
                    const json = JSON.parse(dataStr);
                    const delta = json.choices?.[0]?.delta;
                    if (!delta) continue;
                    if (delta.reasoning_content) {
                        yield { type: 'reasoning', text: delta.reasoning_content };
                    }
                    if (delta.content) {
                        yield { type: 'content', text: delta.content };
                    }
                } catch {
                    // 忽略解析错误
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}