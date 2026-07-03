import * as vscode from 'vscode';
import * as ast from '../utils/astUtils';

interface RegularMethodEntry {
    returnType: string;
    name: string;
    params: string;
}

export class AddRegularMethodPanel {
    public static currentPanel: AddRegularMethodPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private readonly _className: string;
    private readonly _headerUri: vscode.Uri;
    private readonly _sourceUri: vscode.Uri;
    private readonly _currentMethods: RegularMethodEntry[];
    // 新增：方法添加成功后的回调
    private readonly _onModified?: (className: string, relativePath: string) => void;

    public static createOrShow(
        extensionUri: vscode.Uri,
        className: string,
        headerUri: vscode.Uri,
        sourceUri: vscode.Uri,
        currentMethods: RegularMethodEntry[],
        onModified?: (className: string, relativePath: string) => void   // 新增参数
    ) {
        if (AddRegularMethodPanel.currentPanel) {
            AddRegularMethodPanel.currentPanel.dispose();
        }
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
        const panel = vscode.window.createWebviewPanel(
            'oocAddRegularMethod',
            `Add Regular Methods to ${className}`,
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        AddRegularMethodPanel.currentPanel = new AddRegularMethodPanel(
            panel, extensionUri, className, headerUri, sourceUri, currentMethods, onModified
        );
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        className: string,
        headerUri: vscode.Uri,
        sourceUri: vscode.Uri,
        currentMethods: RegularMethodEntry[],
        onModified?: (className: string, relativePath: string) => void   // 新增参数
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._className = className;
        this._headerUri = headerUri;
        this._sourceUri = sourceUri;
        this._currentMethods = currentMethods;
        this._onModified = onModified;   // 保存回调

        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                if (message.command === 'addMethods') {
                    await this._handleAddMethods(message.methods);
                } else if (message.command === 'cancel') {
                    this._panel.dispose();
                }
            },
            null,
            this._disposables
        );
    }

    public dispose() {
        AddRegularMethodPanel.currentPanel = undefined;
        this._panel.dispose();
        this._disposables.forEach(d => d.dispose());
    }

    private _update() {
        this._panel.webview.html = this._getHtmlContent();
    }

    private async _handleAddMethods(methods: RegularMethodEntry[]) {
        try {
            // 重名检查
            const existingNames = this._currentMethods.map(m => m.name);
            for (const m of methods) {
                if (existingNames.includes(m.name)) {
                    vscode.window.showErrorMessage(`Method "${m.name}" already exists.`);
                    return;
                }
                if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(m.name)) {
                    vscode.window.showErrorMessage(`Invalid method name: ${m.name}`);
                    return;
                }
            }

            for (const m of methods) {
                const selfParam = `${this._className} *self`;
                const fullParams = m.params ? `${selfParam}, ${m.params}` : selfParam;

                // 1. 头文件：向 Fun 结构体插入函数指针声明
                const headerDoc = await vscode.workspace.openTextDocument(this._headerUri);
                const funMemberDecl = `${m.returnType} (*${m.name})(${fullParams});`;
                await ast.insertFunMember(headerDoc, this._className, funMemberDecl);

                // 2. 源文件：static 实现函数
                let sourceDoc = await vscode.workspace.openTextDocument(this._sourceUri);
                const decl = `static ${m.returnType} ${this._className}_${m.name}(${fullParams});`;
                if (!sourceDoc.getText().includes(decl)) {
                    await ast.insertAfterIncludes(sourceDoc, decl);
                }
                sourceDoc = await vscode.workspace.openTextDocument(this._sourceUri);

                const impl = `
static ${m.returnType} ${this._className}_${m.name}(${fullParams}) {
    /* TODO: Implement */
    ${m.returnType === 'void' ? '' : `static ${m.returnType} ret = {0}; return ret;`}
}
`;
                await ast.insertAtEndOfFile(sourceDoc, impl);

                // 3. 源文件：在 _fun 初始化列表中添加成员
                sourceDoc = await vscode.workspace.openTextDocument(this._sourceUri);
                await ast.insertFunInit(sourceDoc, this._className, m.name, `${this._className}_${m.name}`);
            }

            // 保存文件
            const finalHeaderDoc = await vscode.workspace.openTextDocument(this._headerUri);
            await finalHeaderDoc.save();
            const finalSourceDoc = await vscode.workspace.openTextDocument(this._sourceUri);
            await finalSourceDoc.save();

            // 新增：回调通知外部同步缓存
            if (this._onModified) {
                const relativePath = vscode.workspace.asRelativePath(this._headerUri);
                this._onModified(this._className, relativePath);
            }

            vscode.window.showInformationMessage(`Successfully added ${methods.length} regular method(s) to ${this._className}.`);
            this._panel.dispose();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to add methods: ${err}`);
        }
    }

    private _getHtmlContent(): string {
        const currentRows = this._currentMethods.length > 0
            ? this._currentMethods.map(m => `
                <tr><td>${m.returnType}</td><td>${m.name}</td><td>${m.params}</td></tr>`).join('')
            : '<tr><td colspan="3">No existing regular methods</td></tr>';

        const existingNames = JSON.stringify(this._currentMethods.map(m => m.name));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Add Regular Methods</title>
    <style>
        body { font-family: var(--vscode-editor-font-family); padding: 15px; color: var(--vscode-foreground); }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th, td { text-align: left; padding: 6px; border-bottom: 1px solid var(--vscode-input-border); }
        .method-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
        input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px; }
        button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; cursor: pointer; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        .actions { display: flex; gap: 8px; margin-top: 15px; }
        .remove-btn { flex: none; width: 24px; text-align: center; }
        .error { color: red; font-size: 12px; }
    </style>
</head>
<body>
    <h3>Add Regular Methods for class <em>${this._className}</em></h3>

    <h4>Current Regular Methods</h4>
    <table>
        <thead><tr><th>Return</th><th>Name</th><th>Params</th></tr></thead>
        <tbody>${currentRows}</tbody>
    </table>

    <h4>New Regular Methods</h4>
    <div id="method-list"></div>
    <div class="actions">
        <button id="add-row-btn">+ Add Method</button>
        <button id="submit-btn">Submit All</button>
        <button id="cancel-btn">Cancel</button>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const existingNames = new Set(${existingNames});

        function createRow() {
            const row = document.createElement('div');
            row.className = 'method-row';
            row.innerHTML = \`
                <input type="text" class="return-type" placeholder="void" value="void">
                <input type="text" class="method-name" placeholder="methodName" required>
                <input type="text" class="params" placeholder="e.g., int speed">
                <button class="remove-btn" onclick="this.parentElement.remove()">✕</button>
                <span class="error" style="display:none;">Name already exists</span>
            \`;
            const nameInput = row.querySelector('.method-name');
            const errorSpan = row.querySelector('.error');
            nameInput.addEventListener('input', () => {
                if (existingNames.has(nameInput.value.trim())) {
                    errorSpan.style.display = 'inline';
                } else {
                    errorSpan.style.display = 'none';
                }
            });
            document.getElementById('method-list').appendChild(row);
        }

        createRow();
        document.getElementById('add-row-btn').addEventListener('click', createRow);

        document.getElementById('submit-btn').addEventListener('click', () => {
            const rows = document.querySelectorAll('.method-row');
            const methods = [];
            for (const row of rows) {
                const returnType = row.querySelector('.return-type').value.trim() || 'void';
                const name = row.querySelector('.method-name').value.trim();
                const params = row.querySelector('.params').value.trim();
                if (!name) { alert('Method name is required.'); return; }
                if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) { alert('Invalid method name: ' + name); return; }
                if (existingNames.has(name)) {
                    alert('Method "' + name + '" already exists.');
                    return;
                }
                methods.push({ returnType, name, params });
            }
            if (methods.length === 0) { alert('Please add at least one method.'); return; }
            vscode.postMessage({ command: 'addMethods', methods });
        });

        document.getElementById('cancel-btn').addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });
    </script>
</body>
</html>`;
    }
}