import * as vscode from 'vscode';
import { findStruct, getFunMethods, getVirtualMethods, StructInfo } from '../utils/astUtils';
import { PlantUmlDiagramPanel } from '../panels/PlantUmlDiagramPanel';
import { InheritanceTreeDataProvider, InheritanceNode } from '../inheritanceTreeProvider';
import { relationStore } from '../sync/ClassRelationStore';
import { syncService } from '../sync/ClassSyncService';

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

// ---- 辅助函数：提取普通方法 ----
function getRegularMethods(
    document: vscode.TextDocument,
    className: string
): { returnType: string; name: string; params: string }[] {
    try {
        const text = document.getText();
        const escapedName = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(
            `([\\w\\s\\*]+?)\\s+(${escapedName}_(\\w+))\\s*\\(([^)]*)\\)\\s*;`,
            'g'
        );
        const methods: { returnType: string; name: string; params: string }[] = [];
        let m;
        while ((m = regex.exec(text)) !== null) {
            const methodName = m[3];
            const returnType = m[1].trim();
            const params = m[4].trim();
            if (methodName.startsWith('default_') || methodName.startsWith('override_')) continue;
            methods.push({ returnType, name: methodName, params });
        }
        return methods;
    } catch {
        return [];
    }
}

// ---- 从方法参数中提取依赖 ----
function extractDependencies(
    methods: { name: string; params: string }[],
    className: string,
    parentName: string | null,
    classSet: Set<string>
): { target: string; method: string }[] {
    const deps: { target: string; method: string }[] = [];
    for (const m of methods) {
        const words = m.params.match(/\b([A-Za-z_]\w*)\b/g);
        if (!words) continue;
        for (const w of words) {
            if (w !== className && w !== parentName && classSet.has(w)) {
                deps.push({ target: w, method: m.name });
            }
        }
    }
    return deps;
}

// ---- 从结构体成员提取聚合依赖 ----
function extractMemberDependencies(
    structInfo: StructInfo,
    className: string,
    parentName: string | null,
    classSet: Set<string>
): { target: string; memberName: string }[] {
    const result: { target: string; memberName: string }[] = [];
    for (const member of structInfo.members) {
        if (member.name === 'vtable' || member.name === '_vtable' || member.name === 'fun') continue;
        if (member.type === 'union/struct') continue;
        let typeName = member.type.replace('struct ', '').trim();
        if (member.isPointer && typeName.endsWith('*')) typeName = typeName.slice(0, -1).trim();
        if (classSet.has(typeName) && typeName !== className && typeName !== parentName) {
            result.push({ target: typeName, memberName: member.name });
        }
    }
    return result;
}

// ---- 从 InheritanceNode 构建完整的 OocClass ----
async function buildOocClassFromNode(
    node: InheritanceNode,
    classSet: Set<string>
): Promise<OocClass> {
    const uri = node.headerUri;
    const document = await vscode.workspace.openTextDocument(uri);

    // 虚函数
    let virtualMethods: { returnType: string; name: string; params: string }[] = [];
    if (node.hasVtable) {
        virtualMethods = getVirtualMethods(document, node.name);
    }

    // fun方法 和 普通方法
    const funMethods = getFunMethods(document, node.name);
    const regularMethods = getRegularMethods(document, node.name);

    // 属性
    const structInfo = findStruct(document, node.name);
    const attributes: { name: string; type: string }[] = [];
    if (structInfo) {
        for (const m of structInfo.members) {
            if (m.text.startsWith('union') || m.text.startsWith('struct')) {
                const bodyMatch = m.text.match(/\{([^}]*)\}/);
                if (bodyMatch) {
                    const innerBody = bodyMatch[1];
                    const statements = innerBody.split(';');
                    for (const stmt of statements) {
                        const trimmed = stmt.trim();
                        if (!trimmed) continue;
                        const cleanStmt = trimmed.replace(/\/\/.*/, '').trim();
                        const parts = cleanStmt.split(/\s+/);
                        if (parts.length < 2) continue;
                        const varName = parts[parts.length - 1].replace(/^\*/, '');
                        const type = parts.slice(0, -1).join(' ');
                        if (varName === 'vtable' || varName === '_vtable' || varName === 'fun') continue;
                        attributes.push({ name: varName, type });
                    }
                }
                continue;
            }
            // 普通成员
            if (m.name && m.type) {
                if (m.name === 'vtable' || m.name === '_vtable' || m.name === 'fun') continue;
                attributes.push({ name: m.name, type: m.type });
            }
        }
    }

    const parentName = node.parentName;
    const allMethods = [...virtualMethods, ...funMethods, ...regularMethods];
    const dependencies = extractDependencies(allMethods, node.name, parentName, classSet);
    const memberDeps = structInfo ? extractMemberDependencies(structInfo, node.name, parentName, classSet) : [];

    // ----- 判断是否为接口 -----
    let isInterface = false;
    if (virtualMethods.length > 0) {
        const sourceUri = vscode.Uri.joinPath(uri, '..', `${node.name}.c`);
        try {
            const sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
            const sourceText = sourceDoc.getText();
            if (sourceText.includes('/* OOC_INTERFACE */')) {
                isInterface = true;
            } else {
                const hasAnyImpl = virtualMethods.some(m =>
                    sourceText.includes(`default_${node.name}_${m.name}_impl`)
                );
                isInterface = !hasAnyImpl;
            }
        } catch { /* 源文件不存在，保持 false */ }
    }

    // ----- 同步 isInterface 到缓存 -----
    const entry = relationStore.getClass(node.name);
    if (entry && entry.isInterface !== isInterface) {
        const relativePath = vscode.workspace.asRelativePath(uri);
        await syncService.registerClass(
            node.name,
            relativePath,
            node.parentName,
            node.hasVtable,
            isInterface
        );
    }

    return {
        name: node.name,
        filePath: uri.fsPath,
        parentName,
        virtualMethods,
        regularMethods,
        attributes,
        funMethods,
        hasVtable: node.hasVtable,
        isInterface,
        dependencies,
        memberDependencies: memberDeps
    };
}

// ---- 主入口 ----
export async function showClassDiagram(
    context: vscode.ExtensionContext,
    provider: InheritanceTreeDataProvider,
    highlightClassName?: string
) {
    const allNodes = await provider.getAllClasses();
    if (allNodes.length === 0) {
        vscode.window.showInformationMessage(
            'No OOC classes in the relation table. Use the plugin commands first.'
        );
        return;
    }

    const classSet = new Set(allNodes.map(n => n.name));
    const oocClasses: OocClass[] = [];

    for (const node of allNodes) {
        const ooc = await buildOocClassFromNode(node, classSet);
        oocClasses.push(ooc);
    }

    PlantUmlDiagramPanel.createOrShow(context.extensionUri, oocClasses, highlightClassName);
}