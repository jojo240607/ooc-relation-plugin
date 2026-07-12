import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { callAIForFunctionCalls, callAIForText, streamAIForText } from './aiClient';
import { OOC_TOOLS } from './tools';
import { executeFunctionCalls } from './agentExecutor';
import { relationStore } from '../sync/ClassRelationStore';
import { McpClient } from '../mcp/mcpClient';
import { exec } from 'child_process';
import { promisify } from 'util';

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    text: string;
}

interface PersistedData {
    chatHistory: ChatMessage[];
    inputHistory: string[];
    fullHistory?: any[];
}

const MAX_HISTORY_SIZE = 20;
const execAsync = promisify(exec);

// 工具结果最大字符数（超过则截断）
const TOOL_RESULT_MAX_LENGTH = 2000;

function trimHistoryByTurns(history: any[], maxTurns: number): any[] {
    const turns: any[][] = [];
    let currentTurn: any[] = [];
    for (const msg of history) {
        if (msg.role === 'user' && currentTurn.length > 0) {
            turns.push(currentTurn);
            currentTurn = [];
        }
        currentTurn.push(msg);
    }
    if (currentTurn.length > 0) turns.push(currentTurn);
    return turns.slice(-maxTurns).flat();
}

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private _view?: vscode.WebviewView;
    private _chatHistory: ChatMessage[] = [];
    private _inputHistory: string[] = [];
    private _fullHistory: any[] = [];
    private _allTools: any[] = [...OOC_TOOLS];
    private _cachedArchitecture: string = '';
    private _commandExecutionAllowed: boolean = false;

    constructor(private readonly _context: vscode.ExtensionContext,
        private mcpClient: McpClient
    ) {
        this._loadPersistedData();
        this.mcpClient.start()
            .then(() => {
                console.log('[MCP] Process started');
                setTimeout(() => this._updateTools(), 2000);
            })
            .catch(err => {
                console.error('[MCP] Start failed:', err);
                vscode.window.showErrorMessage('MCP 启动失败，高级分析不可用');
            });

        _context.subscriptions.push(this);
    }

    dispose() {
        this.mcpClient.dispose();
    }

    private get _workspaceRoot(): string {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    }

    private _getDataFilePath(): string {
        return path.join(this._workspaceRoot, '.vscode', 'ooc-chat-data.json');
    }

    private _loadPersistedData() {
        const filePath = this._getDataFilePath();
        if (!this._workspaceRoot || !fs.existsSync(filePath)) return;
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed: PersistedData = JSON.parse(raw);

            this._chatHistory = (parsed.chatHistory || []).map(m => ({
                role: m.role as 'user' | 'assistant' | 'system',
                text: m.text || ''
            }));
            this._inputHistory = (parsed.inputHistory || []).filter(t => typeof t === 'string');

            if (parsed.fullHistory && Array.isArray(parsed.fullHistory)) {
                this._fullHistory = parsed.fullHistory;
            } else {
                this._fullHistory = this._chatHistory.map(m => ({
                    role: m.role,
                    content: m.text
                }));
            }
        } catch (err) {
            console.error('[ChatView] Failed to load data:', err);
        }
    }

    private _savePersistedData() {
        if (!this._workspaceRoot) return;
        const dir = path.join(this._workspaceRoot, '.vscode');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const chat = this._chatHistory.length > MAX_HISTORY_SIZE
            ? this._chatHistory.slice(-MAX_HISTORY_SIZE) : this._chatHistory;
        const input = this._inputHistory.length > 100
            ? this._inputHistory.slice(-100) : this._inputHistory;

        const MAX_TURNS = 50;
        const full = trimHistoryByTurns(this._fullHistory, MAX_TURNS);

        const data: PersistedData = {
            chatHistory: chat,
            inputHistory: input,
            fullHistory: full
        };

        try {
            fs.writeFileSync(this._getDataFilePath(), JSON.stringify(data, null, 2), 'utf-8');
        } catch (err) {
            console.error('[ChatView] Failed to save data:', err);
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this._getHtml();

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            if (msg.command === 'ask') {
                await this._handleAsk(msg.text);
            }
        });
    }

    // ========== 新增：工具结果截断 ==========
    private _truncateToolResult(result: string, maxLen: number = TOOL_RESULT_MAX_LENGTH): string {
        if (result.length <= maxLen) return result;
        return result.substring(0, maxLen) + `\n... [工具返回过长，已截断，剩余 ${result.length - maxLen} 字符]`;
    }

    // ========== 新增：加载基础系统提示（不含动态信息） ==========
    private _loadBasePrompt(): string {
        const workspaceRoot = this._workspaceRoot;
        if (workspaceRoot) {
            const projectPromptPath = path.join(workspaceRoot, '.vscode', 'ooc-ai-prompt.txt');
            if (fs.existsSync(projectPromptPath)) {
                const content = fs.readFileSync(projectPromptPath, 'utf-8').trim();
                if (content) return content;
            }
        }
        return this._loadDefaultPrompt();
    }

    // ========== 新增：构建动态上下文（作为 user 消息） ==========
    private async _buildDynamicContext(existingClassesInfo: string): Promise<string> {
        let context = `Workspace root: ${this._workspaceRoot}\nExisting classes:\n${existingClassesInfo || 'none'}`;

        try {
            const projName = await this._getMcpProjectName();
            if (projName) {
                context += `\nCurrent MCP project name: "${projName}" (use this as 'project' parameter in MCP tools)`;
            }
        } catch (e) {
            console.error('[ChatView] Failed to get MCP project name for context:', e);
        }

        try {
            const mcpTools = await this.mcpClient.getTools();
            if (mcpTools.length > 0) {
                const toolLines = mcpTools.map((t: any) => {
                    const required = t.inputSchema?.required || [];
                    const reqStr = required.length > 0 ? `【必填：${required.join(', ')}】` : '';
                    return `- ${t.name} ${reqStr}：${t.description?.split('.')[0] || ''}`;
                });
                context += `\n\n## 当前可用的 MCP 分析工具\n${toolLines.join('\n')}`;
            }
        } catch (e) {
            console.error('[ChatView] Failed to attach MCP tools to context:', e);
        }

        return context;
    }

    // ========== 新增：历史摘要与压缩 ==========
    private async _maybeSummarizeHistory(): Promise<void> {
        const MAX_TURNS = 3;  // 保留最近 3 个完整对话轮次

        // 按轮次拆分历史（每个轮次以 user 消息开始）
        const turns: any[][] = [];
        let currentTurn: any[] = [];
        for (const msg of this._fullHistory) {
            if (msg.role === 'user' && currentTurn.length > 0) {
                turns.push(currentTurn);
                currentTurn = [];
            }
            currentTurn.push(msg);
        }
        if (currentTurn.length > 0) turns.push(currentTurn);

        // 如果轮次数量不超过 MAX_TURNS，不需要压缩
        if (turns.length <= MAX_TURNS) return;

        // 旧轮次用于生成摘要，新轮次保留
        const oldTurns = turns.slice(0, turns.length - MAX_TURNS);
        const recentTurns = turns.slice(-MAX_TURNS);

        try {
            // 将旧轮次合并成消息列表用于摘要
            const oldMessages = oldTurns.flat();
            const summary = await this._summarizeConversation(oldMessages);
            if (summary) {
                // 重建 _fullHistory：摘要 + 最近轮次（确保以 user 消息开始）
                this._fullHistory = [
                    { role: 'user', content: `[历史对话摘要]\n${summary}` },
                    ...recentTurns.flat()
                ];

                // 同步压缩前端 chatHistory（保留最近 5 条用户/助手对话）
                const recentChatMessages = this._chatHistory.slice(-5);
                const oldChatMessages = this._chatHistory.slice(0, -5);
                if (oldChatMessages.length > 0) {
                    const chatSummary = await this._summarizeConversation(
                        oldChatMessages.map(m => ({ role: m.role, content: m.text }))
                    );
                    this._chatHistory = [
                        { role: 'system', text: `对话摘要：${chatSummary}` },
                        ...recentChatMessages
                    ];
                }
            }
        } catch (e) {
            console.error('[ChatView] History summarization failed, falling back to truncation:', e);
            // 降级：直接丢弃最旧的轮次，保留最近 MAX_TURNS 个轮次
            this._fullHistory = recentTurns.flat();
            this._chatHistory = this._chatHistory.slice(-10);
        }
    }

    private _ensureValidToolSequence(messages: any[]): any[] {
        const valid: any[] = [];
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.role === 'tool') {
                // 确保前一条是带有 tool_calls 的 assistant 消息
                const prev = valid[valid.length - 1];
                if (prev && prev.role === 'assistant' && prev.tool_calls) {
                    valid.push(msg);
                } else {
                    // 跳过孤立的 tool 消息
                    console.warn('[ChatView] Skipping orphan tool message:', msg.tool_call_id);
                }
            } else {
                valid.push(msg);
            }
        }
        return valid;
    }
    private async _summarizeConversation(messages: any[]): Promise<string> {
        // 仅提取 user 和 assistant 的文本内容，避免工具调用细节干扰
        const textPairs = messages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => `${m.role}: ${m.content || ''}`)
            .join('\n');

        if (!textPairs.trim()) return '';

        const summaryMessages = [
            { role: 'system', content: '你是一个对话摘要助手。请将以下对话历史总结为一段300字以内的中文摘要，只保留关键问题和结论。' },
            { role: 'user', content: textPairs }
        ];

        return await callAIForText(summaryMessages);
    }

    private async _handleAsk(userInput: string) {
        if (!this._view || !userInput) return;

        this._inputHistory.push(userInput);
        const userMsg: ChatMessage = { role: 'user', text: userInput };
        this._chatHistory.push(userMsg);
        this._fullHistory.push({ role: 'user', content: userInput });
        this._savePersistedData();

        let existingClassesInfo = '';
        try {
            const classNames = relationStore.getAllClassNames();
            existingClassesInfo = classNames.map(name => {
                const entry = relationStore.getClass(name);
                const filePath = entry
                    ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, entry.file).fsPath
                    : `${name}.h`;
                return `${name} -> ${filePath}`;
            }).join('\n');
        } catch (err) {
            console.error('[ChatView] Failed to get existing classes:', err);
        }

        // 1. 加载固定系统提示（不含动态信息）
        let basePrompt: string;
        try {
            basePrompt = this._loadBasePrompt();
        } catch (err: any) {
            this._sendError(`❌ 配置错误: ${err.message}`);
            return;
        }

        // 2. 尝试进行历史摘要
        await this._maybeSummarizeHistory();

        // 3. 构建动态上下文（作为 user 消息）
        const dynamicContext = await this._buildDynamicContext(existingClassesInfo);

        // 4. 组装 messages：固定 system + 动态 user + 历史
        const messages: any[] = [
            { role: 'system', content: basePrompt },
            { role: 'user', content: `[系统上下文]\n${dynamicContext}` }
        ];

        // 历史中不应再有 system 消息，但安全起见过滤掉
        const cleanHistory = this._fullHistory.filter(m => m.role !== 'system');
        const validHistory = this._ensureValidToolSequence(cleanHistory);
        messages.push(...validHistory);
        messages.push(...cleanHistory);

        let allResults: string[] = [];
        const maxSteps = 50;

        try {
            for (let step = 0; step < maxSteps; step++) {
                const result = await callAIForFunctionCalls(messages, this._allTools, step === 0);
                const calls = result.calls;
                const assistantMsg = result.assistantMessage;
                if (calls.length === 0) break;

                const stepDesc = calls.map(c => c.name).join(', ');
                const stepId = 'step-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
                this._view.webview.postMessage({
                    command: 'stepStart',
                    stepId: stepId,
                    text: `正在执行: ${stepDesc}...`,
                    reasoning: assistantMsg?.reasoning_content || null
                });

                const results = await this._executeWithMCPFallback(calls);
                const resultText = results.join('\n');
                this._view.webview.postMessage({ command: 'stepResult', text: resultText });
                allResults.push(...results);

                // 处理 update_ai_prompt （插入 user 消息而非 system）
                calls.forEach((call, idx) => {
                    if (call.name === 'update_ai_prompt' && results[idx]?.startsWith('✅')) {
                        const content = call.arguments.content;
                        messages.push({
                            role: 'user',   // 改为 user 角色
                            content: `【提示词已更新】请立即遵守以下新规则：\n${content.substring(0, 500)}`
                        });
                    }
                });

                // 保存 assistant 消息
                const safeAssistantMsg = {
                    role: 'assistant',
                    content: assistantMsg.content || null,
                    tool_calls: assistantMsg.tool_calls?.map((tc: any) => ({
                        id: tc.id,
                        type: 'function',
                        function: {
                            name: tc.function.name,
                            arguments: typeof tc.function.arguments === 'string'
                                ? tc.function.arguments
                                : JSON.stringify(tc.function.arguments)
                        }
                    }))
                };
                messages.push(safeAssistantMsg);
                this._fullHistory.push(safeAssistantMsg);

                // 保存工具结果（截断后再保存）
                results.forEach((res, i) => {
                    const toolMsg = {
                        role: 'tool',
                        tool_call_id: assistantMsg.tool_calls[i].id,
                        content: this._truncateToolResult(res)   // 截断工具结果
                    };
                    messages.push(toolMsg);
                    this._fullHistory.push(toolMsg);
                });

                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // 生成最终总结
            let finalText = '';
            let isStreaming = false;

            if (allResults.length > 0) {
                isStreaming = true;
                // 精简的最终指令，使用 user 角色
                messages.push({
                    role: 'user',
                    content: '请根据上面的工具执行结果，生成最终的中文分析报告（不要调用工具，直接输出文本）。'
                });

                this._view.webview.postMessage({ command: 'streamStart' });
                try {
                    const stream = streamAIForText(messages);
                    for await (const chunk of stream) {
                        if (chunk.type === 'reasoning') {
                            this._view?.webview.postMessage({ command: 'streamThinking', text: chunk.text });
                        } else {
                            finalText += chunk.text;
                            this._view?.webview.postMessage({ command: 'streamChunk', text: chunk.text });
                        }
                    }
                    this._view?.webview.postMessage({ command: 'streamEnd' });
                } catch (err) {
                    this._view?.webview.postMessage({ command: 'streamEnd', error: true });
                    finalText = '⚠️ 流式总结生成失败: ' + (err as Error).message;
                }
            } else {
                // 没有工具调用，直接取助手第一条文本回复
                const firstAssistantMsg = messages.find(m => m.role === 'assistant' && m.content);
                if (firstAssistantMsg?.content) {
                    finalText = firstAssistantMsg.content;
                } else {
                    finalText = '';
                }
            }

            // 保存最终结果并通知前端
            if (finalText) {
                const assistantSimpleMsg: ChatMessage = { role: 'assistant', text: finalText };
                this._chatHistory.push(assistantSimpleMsg);
                this._fullHistory.push({ role: 'assistant', content: finalText });
                this._savePersistedData();

                if (!isStreaming) {
                    this._view?.webview.postMessage({ command: 'addMessage', role: 'assistant', text: finalText });
                }
            } else {
                this._view?.webview.postMessage({ command: 'addMessage', role: 'assistant', text: 'AI 未给出有效回复。' });
            }

        } catch (err: any) {
            this._sendError(`❌ AI 调用失败: ${err.message}`);
        }
    }

    private async _executeWithMCPFallback(calls: { name: string; arguments: any }[]): Promise<string[]> {
        const results: string[] = [];
        const oocToolNames = new Set(OOC_TOOLS.map(t => t.function.name));

        const projectTools = new Set([
            'search_graph', 'query_graph', 'get_code_snippet', 'get_graph_schema',
            'get_architecture', 'search_code', 'delete_project', 'index_status',
            'detect_changes', 'manage_adr', 'ingest_traces', 'trace_path'
        ]);
        const repoPathTools = new Set(['index_repository']);

        for (const call of calls) {
            if (call.name === 'update_ai_prompt') {
                const res = await this._handleUpdatePrompt(call.arguments);
                results.push(res);
                continue;
            }
            if (call.name === 'run_command') {
                const res = await this._executeCommand(call.arguments.command, call.arguments.timeout || 30);
                results.push(res);
                continue;
            }

            if (oocToolNames.has(call.name)) {
                const [result] = await executeFunctionCalls([call]);
                results.push(result);
            } else {
                if (projectTools.has(call.name) && !call.arguments.project) {
                    const projectName = await this._getMcpProjectName();
                    if (projectName) {
                        call.arguments.project = projectName;
                        console.log(`[MCP AutoFix] Added project="${projectName}" for ${call.name}`);
                    }
                }
                if (repoPathTools.has(call.name) && !call.arguments.repo_path) {
                    call.arguments.repo_path = this._workspaceRoot;
                    console.log(`[MCP AutoFix] Added repo_path="${this._workspaceRoot}" for ${call.name}`);
                }
                if (call.name === 'search_graph' && !call.arguments.limit) {
                    call.arguments.limit = 10;
                    console.log('[MCP AutoFix] Added default limit=10 for search_graph');
                }

                try {
                    const mcpResult = await this.mcpClient.callTool(call.name, call.arguments);
                    const prefix = mcpResult.success ? '✅ [MCP]' : '❌ [MCP]';
                    results.push(`${prefix} ${call.name}: ${mcpResult.message}`);
                } catch (err: any) {
                    results.push(`❌ [MCP] ${call.name}: ${err.message}`);
                }
            }
        }
        return results;
    }

    private async _handleUpdatePrompt(args: {
        action: 'append' | 'replace_section' | 'prepend';
        section_title?: string;
        content: string;
    }): Promise<string> {
        const workspaceRoot = this._workspaceRoot;
        if (!workspaceRoot) {
            return '❌ update_ai_prompt: 未打开工作区';
        }
        const promptPath = path.join(workspaceRoot, '.vscode', 'ooc-ai-prompt.txt');
        if (!fs.existsSync(promptPath)) {
            const defaultPromptPath = path.join(this._context.extensionPath, 'resources', 'default-prompt.txt');
            if (fs.existsSync(defaultPromptPath)) {
                fs.copyFileSync(defaultPromptPath, promptPath);
            } else {
                return '❌ update_ai_prompt: 默认提示词文件缺失，无法创建';
            }
        }
        let currentContent = fs.readFileSync(promptPath, 'utf-8');
        const { action, section_title, content } = args;

        if (action === 'append') {
            currentContent += '\n\n' + content;
        } else if (action === 'prepend') {
            currentContent = content + '\n\n' + currentContent;
        } else if (action === 'replace_section') {
            if (!section_title) {
                return '❌ update_ai_prompt: replace_section 需要 section_title 参数';
            }
            const escaped = section_title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(## ${escaped}[\\s\\S]*?)(?=\n## |\n*$)`, 'gm');
            if (!regex.test(currentContent)) {
                return `❌ update_ai_prompt: 未找到章节 "${section_title}"`;
            }
            currentContent = currentContent.replace(regex, `## ${section_title}\n${content}`);
        }

        try {
            fs.writeFileSync(promptPath, currentContent, 'utf-8');
            return `✅ update_ai_prompt: 提示词已更新 (${action})`;
        } catch (err: any) {
            return `❌ update_ai_prompt: 写入失败 - ${err.message}`;
        }
    }

    private async _getAiTextResponse(messages: any[]): Promise<string> {
        try {
            return await callAIForText(messages);
        } catch (err) {
            console.error('Failed to get AI text response:', err);
            return '';
        }
    }

    private _sendError(text: string) {
        if (this._view) {
            const msg: ChatMessage = { role: 'system', text };
            this._chatHistory.push(msg);
            this._savePersistedData();
            this._view.webview.postMessage({ command: 'error', text });
        }
    }

    // 原 _loadSystemPrompt 已拆分为 _loadBasePrompt + _buildDynamicContext，不再需要
    private _loadDefaultPrompt(): string {
        const defaultPromptPath = path.join(this._context.extensionPath, 'resources', 'default-prompt.txt');
        if (!fs.existsSync(defaultPromptPath)) {
            throw new Error(`默认提示词文件缺失：${defaultPromptPath}`);
        }
        const defaultContent = fs.readFileSync(defaultPromptPath, 'utf-8').trim();
        if (!defaultContent) throw new Error('默认提示词文件为空');
        return defaultContent;
    }

    private async _updateTools() {
        const maxRetries = 5;
        for (let i = 0; i < maxRetries; i++) {
            try {
                this.mcpClient.clearToolsCache();
                const mcpTools = await this.mcpClient.getTools();
                console.log(`[MCP] Attempt ${i + 1}: Available tools:`, mcpTools.map((t: any) => t.name));
                if (mcpTools.length > 0) {
                    await this._cacheArchitecture();

                    const openAiFormatted = mcpTools.map((t: any) => ({
                        type: 'function',
                        function: {
                            name: t.name,
                            description: t.description || '',
                            parameters: t.inputSchema || { type: 'object', properties: {} }
                        }
                    }));

                    const toolMap = new Map<string, any>();
                    OOC_TOOLS.forEach(t => toolMap.set(t.function.name, t));

                    openAiFormatted.forEach(t => {
                        if (!toolMap.has(t.function.name)) {
                            toolMap.set(t.function.name, t);
                        }
                    });

                    toolMap.set('update_ai_prompt', {
                        type: 'function',
                        function: {
                            name: 'update_ai_prompt',
                            description: '更新项目的 AI 提示词配置文件 (.vscode/ooc-ai-prompt.txt)，用于沉淀经验、修复规则或添加约定。',
                            parameters: {
                                type: 'object',
                                properties: {
                                    action: {
                                        type: 'string',
                                        enum: ['append', 'replace_section', 'prepend'],
                                        description: '操作类型'
                                    },
                                    section_title: {
                                        type: 'string',
                                        description: '当 action=replace_section 时，指定要替换的章节标题'
                                    },
                                    content: {
                                        type: 'string',
                                        description: '要写入的新内容（纯文本）'
                                    }
                                },
                                required: ['action', 'content']
                            }
                        }
                    });

                    toolMap.set('run_command', {
                        type: 'function',
                        function: {
                            name: 'run_command',
                            description: '在项目工作目录下执行一个 Windows shell 命令，返回标准输出、标准错误和退出码。用于编译、运行测试等。',
                            parameters: {
                                type: 'object',
                                properties: {
                                    command: {
                                        type: 'string',
                                        description: '要执行的完整命令，例如 "gcc main.c -o test.exe && test.exe"'
                                    },
                                    timeout: {
                                        type: 'number',
                                        description: '命令超时秒数，默认 30',
                                        default: 30
                                    }
                                },
                                required: ['command']
                            }
                        }
                    });

                    this._allTools = Array.from(toolMap.values());
                    console.log('[MCP] Total tools:', this._allTools.length);
                    vscode.window.showInformationMessage(`MCP 已就绪，提供 ${mcpTools.length} 个分析工具`);
                    return;
                }
            } catch (e) {
                console.error(`[MCP] Retry ${i + 1} failed:`, e);
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        console.warn('[MCP] Failed to get tools after retries');
    }

    private async _cacheArchitecture() {
        try {
            const projName = await this._getMcpProjectName();
            if (!projName) return;
            const indexStatus = await this.mcpClient.callTool('index_status', { project: projName });
            if (!indexStatus.success || !indexStatus.message.includes('indexed')) {
                await this.mcpClient.callTool('index_repository', { repo_path: this._workspaceRoot });
            }
            const result = await this.mcpClient.callTool('get_architecture', { project: projName });
            if (result.success) {
                this._cachedArchitecture = `## 项目架构缓存（来自 MCP）\n${result.message}\n\n（以上数据在本次会话中有效，后续问题请直接引用）`;
            }
        } catch (e) {
            console.error('[ChatView] Failed to cache architecture:', e);
        }
    }

    private async _getMcpProjectName(): Promise<string> {
        try {
            const res = await this.mcpClient.callTool('list_projects', {});
            if (res.success) {
                let projects: any[] = [];
                try {
                    const parsed = JSON.parse(res.message);
                    if (Array.isArray(parsed)) projects = parsed;
                    else if (parsed.projects && Array.isArray(parsed.projects)) projects = parsed.projects;
                } catch {
                    projects = res.message.split('\n').filter(line => line.trim());
                }
                if (projects.length > 0) {
                    const first = projects[0];
                    return typeof first === 'string' ? first : (first.name || first.project || '');
                }
            }
        } catch (e) {}
        return '';
    }

    private _extractMissingParams(errorMsg: string): string[] {
        const match = errorMsg.match(/(\w+)\s+is required/);
        return match ? [match[1]] : [];
    }

    private _getHtml(): string {
        const htmlPath = path.join(this._context.extensionPath, 'resources', 'chat.html');
        if (!fs.existsSync(htmlPath)) {
            return `<html><body><h3>错误：找不到 chat.html</h3></body></html>`;
        }
        let html = fs.readFileSync(htmlPath, 'utf-8');
        html = html.replace('{{HISTORY_JSON}}', JSON.stringify(this._chatHistory));
        html = html.replace('{{INPUT_HISTORY_JSON}}', JSON.stringify(this._inputHistory));
        return html;
    }

    private async _executeCommand(command: string, timeout: number = 30): Promise<string> {
        const workspaceRoot = this._workspaceRoot;
        if (!workspaceRoot) {
            return '❌ 未打开工作区，无法执行命令';
        }

        const SAFE_COMMANDS = [
            'gcc', 'g++', 'make', 'cmake', 'ctest', 'echo', 'dir', 'ls',
            'mkdir', 'md', 'rmdir', 'del', 'copy', 'xcopy', 'cd', 'pushd', 'popd',
            'set', 'if', 'for', 'type', 'find', 'findstr', 'powershell'
        ];
        
        const firstWord = command.trim().split(/\s+/)[0].toLowerCase();
        const isExeInWorkspace = firstWord.endsWith('.exe') && path.resolve(workspaceRoot, firstWord).startsWith(workspaceRoot);
        const isSafe = SAFE_COMMANDS.some(cmd => firstWord === cmd || firstWord.endsWith(`\\${cmd}`) || firstWord.endsWith(`/${cmd}`)) || isExeInWorkspace;

        if (!isSafe && !this._commandExecutionAllowed) {
            const choice = await vscode.window.showWarningMessage(
                `AI 想要执行命令：\n${command}\n\n是否允许？`,
                { modal: true },
                '允许本次',
                '总是允许（本次会话）',
                '拒绝'
            );
            if (choice === '拒绝' || !choice) {
                return '❌ 用户拒绝了命令执行';
            }
            if (choice === '总是允许（本次会话）') {
                this._commandExecutionAllowed = true;
            }
        }

        try {
            const { stdout, stderr } = await execAsync(command, {
                cwd: workspaceRoot,
                timeout: timeout * 1000,
                maxBuffer: 1024 * 1024,
                shell: 'cmd.exe'
            });
            const output = (stdout + stderr).trim();
            const truncated = output.length > 2000 
                ? output.substring(0, 2000) + '\n... [输出已截断]'
                : output;
            return `✅ 命令执行成功，退出码 0\n${truncated || '(无输出)'}`;
        } catch (err: any) {
            const stderr = err.stderr || '';
            const stdout = err.stdout || '';
            const exitCode = err.code || 'UNKNOWN';
            const output = (stdout + stderr).trim();
            const truncated = output.length > 2000 
                ? output.substring(0, 2000) + '\n... [输出已截断]'
                : output;
            return `❌ 命令执行失败，退出码 ${exitCode}\n${truncated}`;
        }
    }
}