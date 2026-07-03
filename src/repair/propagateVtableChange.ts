import * as vscode from 'vscode';
import * as ast from '../utils/astUtils';
import { relationStore } from '../sync/ClassRelationStore';

export async function propagateVtableChange(className: string) {
    // 直接从关系表获取所有子孙类
    const subclasses = relationStore.getAllDescendants(className);
    console.log(`[propagateVtableChange] Fixing subclasses of ${className}: ${subclasses.join(', ') || 'none'}`);
    for (const childName of subclasses) {
        await fixVtableInheritance(childName);
    }
}

async function fixVtableInheritance(childName: string) {
    console.log(`[fixVtable] Processing ${childName}`);

    // 从关系表获取子类头文件路径
    const childEntry = relationStore.getClass(childName);
    if (!childEntry) {
        console.log(`[fixVtable] ${childName} not in relation store, skipping`);
        return;
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) return;
    const childHeaderUri = vscode.Uri.joinPath(root, childEntry.file);

    let headerDoc = await vscode.workspace.openTextDocument(childHeaderUri);
    const structInfo = ast.findStruct(headerDoc, childName);
    if (!structInfo) return;

    if (!ast.hasVtableField(structInfo)) {
        console.log(`[fixVtable] ${childName} has no vtable field, skipping`);
        return;
    }

    const vtableName = `${childName}Vtable`;
    let vtableStruct = ast.findStruct(headerDoc, vtableName);
    if (!vtableStruct) {
        console.log(`[fixVtable] Vtable struct ${vtableName} not found`);
        return;
    }

    // 从关系表查找最近的有虚表的祖先
    const nearestVtableAncestor = findNearestVtableAncestorFromStore(childName);
    const we = new vscode.WorkspaceEdit();

    if (nearestVtableAncestor) {
        const ancestorName = nearestVtableAncestor;
        console.log(`[fixVtable] Nearest vtable ancestor for ${childName}: ${ancestorName}`);

        let hasParentMember = vtableStruct.members.some(m => m.name === 'parent');
        if (!hasParentMember) {
            let indent = '    ';
            if (vtableStruct.members.length > 0) {
                const firstLine = headerDoc.lineAt(vtableStruct.members[0].line).text;
                const match = firstLine.match(/^(\s*)/);
                if (match) indent = match[0];
            }
            const parentMemberLine = `${indent}struct ${ancestorName}Vtable parent;  /* inherited from ${ancestorName} */`;
            let insertLine = vtableStruct.members.length > 0 ? vtableStruct.members[0].line : vtableStruct.bodyStart + 1;
            const pos = new vscode.Position(insertLine, 0);
            we.insert(childHeaderUri, pos, `${parentMemberLine}\n`);
            headerDoc = await vscode.workspace.openTextDocument(childHeaderUri);
            vtableStruct = ast.findStruct(headerDoc, vtableName)!;
        } else {
            for (const member of vtableStruct.members) {
                if (member.name === 'parent') {
                    const line = headerDoc.lineAt(member.line).text;
                    const newLine = line.replace(
                        /struct\s+\w+Vtable\s+parent\s*;/,
                        `struct ${ancestorName}Vtable parent;`
                    );
                    if (newLine !== line) {
                        const range = new vscode.Range(member.line, 0, member.line, line.length);
                        we.replace(childHeaderUri, range, newLine);
                    }
                    break;
                }
            }
        }

        // 更新源文件中的引用路径
        try {
            const sourceUri = vscode.Uri.joinPath(childHeaderUri, '..', `${childName}.c`);
            const sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
            let sourceText = sourceDoc.getText();

            const depth = computeDepth(childName, ancestorName);
            if (depth >= 1) {
                const newAncestorPath = Array(depth).fill('parent').join('.') + '.vtable';
                const pathRegex = /self->(?:(?:parent)\.)*parent\.vtable/;
                if (pathRegex.test(sourceText)) {
                    sourceText = sourceText.replace(pathRegex, `self->${newAncestorPath}`);
                }
                const sizeofRegex = /sizeof\s*\(\s*struct\s+\w+Vtable\s*\)/g;
                if (sizeofRegex.test(sourceText)) {
                    sourceText = sourceText.replace(sizeofRegex, `sizeof(struct ${ancestorName}Vtable)`);
                }
                const fullRange = new vscode.Range(0, 0, sourceDoc.lineCount, 0);
                we.replace(sourceUri, fullRange, sourceText);
            }
        } catch {}
    } else {
        // 没有祖先有虚表：移除 parent 成员
        const parentMember = vtableStruct.members.find(m => m.name === 'parent');
        if (parentMember) {
            console.log(`[fixVtable] Removing parent member from ${childName} (no vtable ancestor)`);
            const range = new vscode.Range(parentMember.line, 0, parentMember.line + 1, 0);
            we.delete(childHeaderUri, range);
        }
    }

    await vscode.workspace.applyEdit(we);
    // 保存头文件
    const savedHeaderDoc = await vscode.workspace.openTextDocument(childHeaderUri);
    await savedHeaderDoc.save();
    // 保存源文件（如果存在）
    try {
        const sourceUri = vscode.Uri.joinPath(childHeaderUri, '..', `${childName}.c`);
        const savedSourceDoc = await vscode.workspace.openTextDocument(sourceUri);
        await savedSourceDoc.save();
    } catch {}
    console.log(`[fixVtable] Done fixing ${childName}`);
}

/**
 * 利用关系表查找最近有虚表（hasVtable=true）的祖先
 */
function findNearestVtableAncestorFromStore(className: string): string | null {
    let current = className;
    const visited = new Set<string>();
    while (true) {
        const entry = relationStore.getClass(current);
        if (!entry || !entry.parent) return null;
        const parent = entry.parent;
        if (visited.has(parent)) return null;
        visited.add(parent);

        const parentEntry = relationStore.getClass(parent);
        if (parentEntry && parentEntry.hasVtable) {
            return parent;
        }
        current = parent;
    }
}

/**
 * 计算从 child 到 ancestor 的 parent 链深度
 */
function computeDepth(childName: string, targetAncestor: string): number {
    let depth = 0;
    let current = childName;
    const visited = new Set<string>();
    while (current !== targetAncestor) {
        if (visited.has(current)) return -1;
        visited.add(current);
        const entry = relationStore.getClass(current);
        if (!entry || !entry.parent) return -1;
        current = entry.parent;
        depth++;
        if (depth > 20) return -1;
    }
    return depth;
}