import * as vscode from 'vscode';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

/**
 * DeepSeek 配置接口
 */
export interface DeepSeekConfig {
    model: string;
    thinkingEnabled: boolean;
    reasoningEffort: string;
    stream: boolean;
    maxTokens: number;
    temperature: number;
    apiKey: string;  // 如果 API Key 也通过配置或环境变量管理
}

export interface FunctionCall {
    name: string;
    arguments: Record<string, any>;
}

export interface FunctionCallResult {
    calls: FunctionCall[];
    assistantMessage: any;   // 完整的 assistant 消息，保留 reasoning_content 等字段
}

export interface StreamChunk {
    type: 'content' | 'reasoning';
    text: string;
}

/**
 * 从 VSCode 配置中读取 DeepSeek 相关参数
 * 如果未配置，则使用合理的默认值
 */
export async function getDeepSeekConfig(): Promise<DeepSeekConfig> {
    const config = vscode.workspace.getConfiguration('ooc-relation');
    
    // API Key 优先从配置读取，其次从环境变量获取
    const apiKey = config.get<string>('apiKey');
    if (!apiKey) {
        const action = await vscode.window.showErrorMessage(
            'DeepSeek API Key 未配置，请在设置中填写 ooc-relation.apiKey',
            '打开设置'
        );
        if (action === '打开设置') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'ooc-relation.apiKey');
        }
        throw new Error('API key not configured.');
    }
    return {
        model: config.get<string>('model', 'deepseek-v4-flash'),
        thinkingEnabled: config.get<boolean>('thinkingEnabled', true),
        reasoningEffort: config.get<string>('reasoningEffort', 'high'),
        stream: config.get<boolean>('stream', false),
        maxTokens: config.get<number>('maxTokens', 4096),
        temperature: config.get<number>('temperature', 0.7),
        apiKey,
    };
}

export async function callDeepSeekForFunctionCalls(
    messages: { role: string; content: string; tool_calls?: any[]; tool_call_id?: string }[],
    tools: any[],
    requireTool: boolean = false
): Promise<FunctionCallResult> {
    const cfg = await getDeepSeekConfig();  // 一行搞定
    if (!cfg.apiKey) throw new Error('API key not configured.');
    const thinkingType = cfg.thinkingEnabled ? "enabled" : "disabled";
    console.log("deepseek --------- cfg is " + JSON.stringify(cfg));
    const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.apiKey}`
        },
        body: JSON.stringify({
            model: cfg.model,          // 思考模式，支持 Function Calling
            messages: messages,
            thinking: {"type": thinkingType},
            reasoning_effort: cfg.reasoningEffort,
            stream: cfg.stream,
            tools: tools,
            tool_choice: 'auto',//requireTool ? 'required' : 'auto',
            max_tokens: cfg.maxTokens,
            temperature: cfg.temperature,
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    if (!message) {
        return { calls: [], assistantMessage: null };
    }

    // 保留原始消息对象，包括可能存在的 reasoning_content
    const assistantMessage: any = {
        role: message.role,
        content: message.content,
        tool_calls: message.tool_calls,
    };
    // 如果 API 返回了 reasoning_content，也保留下来
    if ((message as any).reasoning_content) {
        assistantMessage.reasoning_content = (message as any).reasoning_content;
    }

    const calls = message.tool_calls?.map((tc: any) => ({
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments)
    })) || [];

    return { calls, assistantMessage };
}


export async function callDeepSeekForText(messages: any[]): Promise<string> {
    console.log("callDeepSeekForText last")
    const cfg = await getDeepSeekConfig();  // 一行搞定
    if (!cfg.apiKey) throw new Error('API key not configured.');
    const thinkingType = cfg.thinkingEnabled ? "enabled" : "disabled";
    const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.apiKey}`
        },
        body: JSON.stringify({
            model: cfg.model,
            messages: messages,
            thinking: {"type": thinkingType},
            reasoning_effort: cfg.reasoningEffort,
            stream: false,
            tool_choice: "none",
            tools: [],
            max_tokens: cfg.maxTokens,
            temperature: cfg.temperature
        })
    });
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
}

/**
 * 流式请求 DeepSeek，返回文本增量
 */
export async function* streamDeepSeekForText(
    messages: any[]
): AsyncGenerator<StreamChunk, void, undefined> {
    const cfg = await getDeepSeekConfig();  // 一行搞定
    if (!cfg.apiKey) throw new Error('API key not configured.');
    const thinkingType = cfg.thinkingEnabled ? "enabled" : "disabled";
    const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.apiKey}`
        },
        body: JSON.stringify({
            model: cfg.model,
            messages: messages,
            stream: true,
            // 启用思考模式，获取 reasoning_content
            thinking: { type: thinkingType },
            reasoning_effort: cfg.reasoningEffort,
            tool_choice: 'none',
            tools: [],
            max_tokens: cfg.maxTokens,
            temperature: cfg.temperature
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek stream error (${response.status}): ${errorText}`);
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

                    // 先输出推理内容
                    if (delta.reasoning_content) {
                        yield { type: 'reasoning', text: delta.reasoning_content };
                    }
                    // 再输出正式回答
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