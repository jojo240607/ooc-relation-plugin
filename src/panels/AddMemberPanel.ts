import * as vscode from 'vscode';
import * as ast from '../utils/astUtils';

export class AddMemberPanel {
    public static currentPanel: AddMemberPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private readonly _headerUri: vscode.Uri;
    private readonly _className: string;
    private readonly _existingMembers: { type: string; name: string }[];
    // 新增：成功添加后的回调
    private readonly _onModified?: (className: string, relativePath: string) => void;

    public static createOrShow(
        extensionUri: vscode.Uri,
        headerUri: vscode.Uri,
        className: string,
        existingMembers: { type: string; name: string }[],
        // 新增可选参数
        onModified?: (className: string, relativePath: string) => void
    ) {
        if (AddMemberPanel.currentPanel) {
            AddMemberPanel.currentPanel.dispose();
        }
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
        const panel = vscode.window.createWebviewPanel(
            'oocAddMembers',
            `Add Members to ${className}`,
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        AddMemberPanel.currentPanel = new AddMemberPanel(
            panel, extensionUri, headerUri, className, existingMembers, onModified
        );
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        headerUri: vscode.Uri,
        className: string,
        existingMembers: { type: string; name: string }[],
        onModified?: (className: string, relativePath: string) => void
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._headerUri = headerUri;
        this._className = className;
        this._existingMembers = existingMembers;
        this._onModified = onModified;
        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            async (msg) => {
                if (msg.command === 'add') {
                    await this._handleAdd(msg.members);
                } else if (msg.command === 'cancel') {
                    this._panel.dispose();
                }
            },
            null,
            this._disposables
        );
    }

    public dispose() {
        AddMemberPanel.currentPanel = undefined;
        this._panel.dispose();
        this._disposables.forEach(d => d.dispose());
    }

    private _update() {
        this._panel.webview.html = this._getHtmlContent();
    }

    private async _handleAdd(members: { type: string; name: string }[]) {
        try {
            const doc = await vscode.workspace.openTextDocument(this._headerUri);
            const structInfo = ast.findStruct(doc, this._className);
            if (!structInfo) {
                vscode.window.showErrorMessage(`Could not find struct ${this._className} in header.`);
                return;
            }

            const endLine = structInfo.bodyEnd;
            if (endLine < 0) {
                vscode.window.showErrorMessage('Invalid struct definition.');
                return;
            }

            const lines = doc.getText().split('\n');
            const braceLine = lines[endLine];
            const braceIndentMatch = braceLine.match(/^(\s*)/);
            const baseIndent = braceIndentMatch ? braceIndentMatch[0] : '';
            const memberIndent = baseIndent + '    ';

            const declarations = members.map(m => `${memberIndent}${m.type} ${m.name};`).join('\n');

            const insertPos = doc.offsetAt(new vscode.Position(endLine, 0));
            const newText = doc.getText().slice(0, insertPos) + declarations + '\n' + doc.getText().slice(insertPos);

            const we = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                doc.positionAt(0),
                doc.positionAt(doc.getText().length)
            );
            we.replace(this._headerUri, fullRange, newText);
            await vscode.workspace.applyEdit(we);

            // 新增：回调通知外部（更新关系表）
            if (this._onModified) {
                const relativePath = vscode.workspace.asRelativePath(this._headerUri);
                this._onModified(this._className, relativePath);
            }

            vscode.window.showInformationMessage(`Added ${members.length} member(s) to ${this._className}.`);
            this._panel.dispose();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to add members: ${err}`);
        }
    }

    private _getHtmlContent(): string {
        // 已有成员列表
        let existingHtml = '';
        if (this._existingMembers.length > 0) {
            const rows = this._existingMembers.map(m =>
                `<div class="existing-member"><span>${m.type}</span> <strong>${m.name}</strong></div>`
            ).join('');
            existingHtml = `
            <div class="existing-section">
                <h4>Existing Members</h4>
                ${rows}
            </div>
            <hr/>`;
        }

        return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Add Members</title>
<style>
    body { font-family: var(--vscode-editor-font-family); padding: 20px; color: var(--vscode-foreground); }
    .existing-section { margin-bottom: 15px; }
    .existing-member { margin-bottom: 4px; font-size: 13px; opacity: 0.85; }
    .existing-member span { margin-right: 8px; color: var(--vscode-descriptionForeground); }
    .row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
    input { flex: 1; padding: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .actions { display: flex; gap: 8px; margin-top: 15px; }
    .remove-btn { width: 24px; text-align: center; }
</style></head>
<body>
    <h3>Add member variables to <em>${this._className}</em></h3>
    ${existingHtml}
    <div id="member-list"></div>
    <button id="add-row">+ Add Member</button>
    <div class="actions">
        <button id="submit">Submit</button>
        <button id="cancel">Cancel</button>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        function createRow() {
            const row = document.createElement('div');
            row.className = 'row';
            row.innerHTML = \`
                <input type="text" class="type" placeholder="int">
                <input type="text" class="name" placeholder="myVar">
                <button class="remove-btn" onclick="this.parentElement.remove()">✕</button>
            \`;
            document.getElementById('member-list').appendChild(row);
        }
        createRow();
        document.getElementById('add-row').onclick = createRow;
        document.getElementById('submit').onclick = () => {
            const members = [];
            document.querySelectorAll('.row').forEach(row => {
                const type = row.querySelector('.type').value.trim();
                const name = row.querySelector('.name').value.trim();
                if (type && name) members.push({ type, name });
            });
            if (members.length === 0) { alert('Enter at least one type and name.'); return; }
            vscode.postMessage({ command: 'add', members });
        };
        document.getElementById('cancel').onclick = () => vscode.postMessage({ command: 'cancel' });
    </script>
</body></html>`;
    }
}