import * as vscode from 'vscode';
import * as plantUmlEncoder from 'plantuml-encoder';

interface OocClass {
    name: string;
    filePath: string;
    parentName: string | null;
    virtualMethods: { returnType: string; name: string; params: string }[];
    regularMethods: { returnType: string; name: string; params: string }[];
    attributes: { name: string; type: string }[];
    funMethods: { returnType: string; name: string; params: string }[];
    hasVtable: boolean;
    isInterface: boolean;
    dependencies: { target: string; method: string }[];
    memberDependencies: { target: string; memberName: string }[];
}

function formatMethodParams(params: string, className: string): string {
    if (!params) return '';
    const parts = params.split(',').map(p => p.trim()).filter(p => p.length > 0);
    const nonSelfParts: string[] = [];
    for (const part of parts) {
        const selfRegex = new RegExp(`^(const\\s+)?${className}\\s*\\*\\s*self$`);
        if (selfRegex.test(part)) continue;
        let cleaned = part.replace(/\bconst\b\s*/g, '').replace(/\s*\*\s*/g, ' ').trim();
        nonSelfParts.push(cleaned);
    }
    return nonSelfParts.join(', ');
}

function getSimpleType(type: string): string {
    return type.replace('struct ', '').replace(/\s*\*\s*$/, '').trim();
}

export class PlantUmlDiagramPanel {
    public static currentPanel: PlantUmlDiagramPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(
        extensionUri: vscode.Uri,
        classes: OocClass[],
        highlightClassName?: string
    ) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (PlantUmlDiagramPanel.currentPanel) {
            PlantUmlDiagramPanel.currentPanel._panel.reveal(column);
            PlantUmlDiagramPanel.currentPanel._update(classes, highlightClassName);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'oocPlantUmlDiagram',
            'OOC Class Diagram (PlantUML)',
            column || vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        const instance = new PlantUmlDiagramPanel(panel, extensionUri, classes, highlightClassName);
        instance._panel.webview.onDidReceiveMessage(
            async (message) => {
                if (message.command === 'savePuml') {
                    const content = message.content;
                    const uri = await vscode.window.showSaveDialog({
                        defaultUri: vscode.Uri.file('class-diagram.puml'),
                        filters: { 'PlantUML Files': ['puml', 'plantuml'], 'All Files': ['*'] }
                    });
                    if (uri) {
                        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
                        vscode.window.showInformationMessage('PlantUML file saved.');
                    }
                }
            },
            null,
            instance._disposables
        );
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        classes: OocClass[],
        highlightClassName?: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._update(classes, highlightClassName);
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public dispose() {
        PlantUmlDiagramPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    private _update(classes: OocClass[], highlightClassName?: string) {
        this._panel.webview.html = this._getHtmlContent(classes, highlightClassName);
    }

    private _getHtmlContent(classes: OocClass[], highlightClassName?: string): string {
        let uml = '@startuml\n';
        uml += 'skinparam classFontStyle bold\n';
        uml += 'skinparam classHeaderFontStyle bold\n';

        for (const cls of classes) {
            const type = cls.isInterface ? 'interface' : 'class';
            const name = cls.name;
            uml += `${type} "${name}"`;
            if (highlightClassName === name) {
                uml += ' #FFCCCC';
            }
            uml += ' {\n';

            // 成员属性
            for (const attr of cls.attributes) {
                const typeName = getSimpleType(attr.type);
                uml += `  - ${typeName} ${attr.name}\n`;
            }
            uml += `  ..\n`;
            // 虚方法
            for (const m of cls.virtualMethods) {
                const params = formatMethodParams(m.params, name);
                const ret = m.returnType !== 'void' ? ` : ${m.returnType}` : '';
                uml += `  + {abstract} <b>${m.name}(${params})${ret}</b>\n`;
            }

            // 普通方法
            const nonVirtual = [...cls.regularMethods, ...cls.funMethods];
            for (const m of nonVirtual) {
                const params = formatMethodParams(m.params, name);
                const ret = m.returnType !== 'void' ? ` : ${m.returnType}` : '';
                uml += `  + ${m.name}(${params})${ret}\n`;
            }

            uml += '}\n';
        }

        // 继承和实现关系
        for (const cls of classes) {
            if (!cls.parentName) continue;
            const parent = classes.find(c => c.name === cls.parentName);
            if (!parent) continue;
            const arrow = parent.isInterface ? '..|>' : '--|>';
            uml += `"${cls.name}" ${arrow} "${cls.parentName}"\n`;
        }

        // 聚合关系
        for (const cls of classes) {
            for (const dep of cls.memberDependencies) {
                uml += `"${cls.name}" o-- "${dep.target}" : ${dep.memberName}\n`;
            }
        }

        // 依赖关系
        for (const cls of classes) {
            for (const dep of cls.dependencies) {
                uml += `"${cls.name}" ..> "${dep.target}" : ${dep.method}\n`;
            }
        }

        uml += '@enduml';

        const encoded = plantUmlEncoder.encode(uml);
        const srcUrl = `https://www.plantuml.com/plantuml/svg/${encoded}`;
        const escapedUml = uml.replace(/\\/g, '\\\\').replace(/`/g, '\\`');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>OOC Class Diagram</title>
    <style>
        body { margin: 0; padding: 10px; background: var(--vscode-editor-background); overflow: hidden; user-select: none; }
        #toolbar { position: fixed; top: 10px; right: 10px; z-index: 1000; display: flex; gap: 5px; }
        #toolbar button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 8px; cursor: pointer; border-radius: 3px; font-size: 14px; }
        #toolbar button:hover { background: var(--vscode-button-hoverBackground); }
        #viewer { width: 100%; height: calc(100vh - 20px); overflow: hidden; position: relative; }
        #img-container { position: absolute; top: 0; left: 0; transform-origin: top left; transition: none; }
        img { display: block; background: white; border-radius: 8px; padding: 10px; }
    </style>
</head>
<body>
    <div id="toolbar">
        <button id="zoom-in" title="Zoom In (Ctrl+Scroll)">➕</button>
        <button id="zoom-out" title="Zoom Out">➖</button>
        <button id="reset" title="Reset View">↺</button>
        <button id="save-puml" title="Save as .puml">💾</button>
    </div>
    <div id="viewer">
        <div id="img-container">
            <img src="${srcUrl}" alt="Class Diagram" id="diagram-img">
        </div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const pumlCode = \`${escapedUml}\`;

        const viewer = document.getElementById('viewer');
        const imgContainer = document.getElementById('img-container');

        let scale = 1.0, translateX = 0, translateY = 0;
        let isDragging = false, startX, startY, startTranslateX, startTranslateY;

        function updateTransform() {
            imgContainer.style.transform = 'translate(' + translateX + 'px, ' + translateY + 'px) scale(' + scale + ')';
        }

        // Ctrl+滚轮：以光标为中心缩放
        viewer.addEventListener('wheel', function(e) {
            if (e.ctrlKey) {
                e.preventDefault();
                const rect = imgContainer.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                const contentX = (mouseX - translateX) / scale;
                const contentY = (mouseY - translateY) / scale;
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                const newScale = Math.min(16.0, Math.max(0.1, scale + delta));
                translateX = mouseX - contentX * newScale;
                translateY = mouseY - contentY * newScale;
                scale = newScale;
                updateTransform();
            }
        });

        // 按钮缩放（仍按左上角缩放，可继续改进）
        document.getElementById('zoom-in').onclick = function() {
            scale = Math.min(16.0, scale + 0.2);
            updateTransform();
        };
        document.getElementById('zoom-out').onclick = function() {
            scale = Math.max(0.1, scale - 0.2);
            updateTransform();
        };
        document.getElementById('reset').onclick = function() {
            scale = 1.0;
            translateX = 0;
            translateY = 0;
            updateTransform();
        };

        // 拖拽
        imgContainer.addEventListener('mousedown', function(e) {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startTranslateX = translateX;
            startTranslateY = translateY;
            e.preventDefault();
        });
        window.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            translateX = startTranslateX + (e.clientX - startX);
            translateY = startTranslateY + (e.clientY - startY);
            updateTransform();
        });
        window.addEventListener('mouseup', function() {
            isDragging = false;
        });

        // 双击重置
        viewer.addEventListener('dblclick', function() {
            scale = 1.0;
            translateX = 0;
            translateY = 0;
            updateTransform();
        });

        // 保存
        document.getElementById('save-puml').addEventListener('click', () => {
            vscode.postMessage({ command: 'savePuml', content: pumlCode });
        });
    </script>
</body>
</html>`;
    }
}