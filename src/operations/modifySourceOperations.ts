import * as vscode from 'vscode';
import * as ast from '../utils/astUtils';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 根据头文件 URI 推导源文件 URI
 */
function getSourceUriFromHeader(headerUri: vscode.Uri): vscode.Uri {
    const className = headerUri.path.split('/').pop()?.replace('.h', '') || 'unknown';
    return vscode.Uri.joinPath(headerUri, '..', `${className}.c`);
}

/**
 * 向源文件末尾添加一个 static 函数
 */
export async function addPrivateFunction(
    headerUri: vscode.Uri,
    returnType: string,
    funcName: string,
    params: string,
    body: string
): Promise<{ success: boolean; message: string }> {
    try {
        const sourceUri = getSourceUriFromHeader(headerUri);
        const doc = await vscode.workspace.openTextDocument(sourceUri);
        const ok = await ast.insertPrivateFunction(doc, returnType, funcName, params, body);
        if (!ok) return { success: false, message: 'Failed to insert function.' };
        return { success: true, message: `Private function ${funcName} added.` };
    } catch (err: any) {
        return { success: false, message: `Error: ${err.message}` };
    }
}

/**
 * 在源文件的 include 区域之后添加一个全局变量
 */
export async function addGlobalVariable(
    headerUri: vscode.Uri,
    type: string,
    name: string,
    initialValue?: string
): Promise<{ success: boolean; message: string }> {
    try {
        const sourceUri = getSourceUriFromHeader(headerUri);
        const doc = await vscode.workspace.openTextDocument(sourceUri);
        const ok = await ast.insertGlobalVariable(doc, type, name, initialValue);
        if (!ok) return { success: false, message: 'Failed to insert variable.' };
        return { success: true, message: `Global variable ${name} added.` };
    } catch (err: any) {
        return { success: false, message: `Error: ${err.message}` };
    }
}

/**
 * 在源文件头部添加 #include 指令
 */
export async function addInclude(
    headerUri: vscode.Uri,
    includePath: string
): Promise<{ success: boolean; message: string }> {
    try {
        const sourceUri = getSourceUriFromHeader(headerUri);
        const doc = await vscode.workspace.openTextDocument(sourceUri);
        const ok = await ast.insertInclude(doc, includePath);
        if (!ok) return { success: false, message: 'Failed to insert include.' };
        return { success: true, message: `Include ${includePath} added.` };
    } catch (err: any) {
        return { success: false, message: `Error: ${err.message}` };
    }
}

/**
 * 修改指定函数的函数体（替换或追加）
 */
export async function modifyFunctionBody(
    headerUri: vscode.Uri,
    functionName: string,
    codeContent: string,
    mode: 'replace' | 'append' = 'append'
): Promise<{ success: boolean; message: string }> {
    const cleanName = functionName.trim();
    try {
        const sourceUri = vscode.Uri.joinPath(headerUri, '..', `${headerUri.path.split('/').pop()?.replace('.h', '')}.c`);
        const doc = await vscode.workspace.openTextDocument(sourceUri);
        let ok = false;
        if (mode === 'replace') {
            ok = await ast.replaceFunctionBody(doc, cleanName, codeContent);
        } else {
            ok = await ast.appendToFunctionBody(doc, cleanName, codeContent);
        }
        if (!ok) {
            return { success: false, message: `Function ${cleanName} not found.` };
        }
        return { success: true, message: `Function ${cleanName} updated.` };
    } catch (err: any) {
        return { success: false, message: `Error modifying function: ${err.message}` };
    }
}


/**
 * 替换或追加整个源文件内容
 */
export async function writeCode(
    headerUri: vscode.Uri,
    codeContent: string,
    mode: 'replace' | 'append' = 'append'
): Promise<{ success: boolean; message: string }> {
    try {
        const className = headerUri.path.split('/').pop()?.replace('.h', '') || 'unknown';
        const sourceUri = vscode.Uri.joinPath(headerUri, '..', `${className}.c`);

        await vscode.workspace.fs.stat(sourceUri); // 确保存在

        const doc = await vscode.workspace.openTextDocument(sourceUri);
        const edit = new vscode.WorkspaceEdit();

        if (mode === 'replace') {
            const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
            edit.replace(sourceUri, fullRange, codeContent);
        } else {
            const lastLine = doc.lineAt(doc.lineCount - 1);
            const insertPos = new vscode.Position(lastLine.range.end.line + 1, 0);
            edit.insert(sourceUri, insertPos, `\n${codeContent}`);
        }

        await vscode.workspace.applyEdit(edit);
        await doc.save();
        return { success: true, message: `Code written to ${sourceUri.fsPath}` };
    } catch (err: any) {
        return { success: false, message: `Error writing code: ${err.message}` };
    }
}

/**
 * 直接向指定路径写入代码（创建文件或追加/替换内容）
 */
export async function writeCodeToPath(
    targetPath: string,
    codeContent: string,
    mode: 'replace' | 'append' = 'append'
): Promise<{ success: boolean; message: string }> {
    try {
        // 确保目录存在
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const targetUri = vscode.Uri.file(targetPath);
        let existingContent = '';
        try {
            const stat = await vscode.workspace.fs.stat(targetUri);
            if (stat) {
                const doc = await vscode.workspace.openTextDocument(targetUri);
                existingContent = doc.getText();
            }
        } catch {
            // 文件不存在，将创建新文件
        }

        const edit = new vscode.WorkspaceEdit();
        if (mode === 'replace' || !existingContent) {
            // 替换模式或文件不存在时，创建/覆盖整个文件
            edit.createFile(targetUri, { overwrite: true });
            // 需要先创建文件再插入内容，或者使用 replace 整个范围
            // 简单做法：创建文件后用 insert
            edit.insert(targetUri, new vscode.Position(0, 0), codeContent);
        } else {
            // 追加模式：在文件末尾插入
            const doc = await vscode.workspace.openTextDocument(targetUri);
            const lastLine = doc.lineAt(doc.lineCount - 1);
            const insertPos = new vscode.Position(lastLine.range.end.line + 1, 0);
            edit.insert(targetUri, insertPos, '\n' + codeContent);
        }

        const success = await vscode.workspace.applyEdit(edit);
        if (!success) {
            return { success: false, message: '❌ 写入文件失败，可能被拒绝' };
        }
        // 保存文件
        const doc = await vscode.workspace.openTextDocument(targetUri);
        await doc.save();
        return { success: true, message: `✅ 代码已写入: ${targetPath}` };
    } catch (err: any) {
        return { success: false, message: `❌ 写入文件错误: ${err.message}` };
    }
}


/**
 * 读取与头文件对应的源文件完整内容
 */
export async function readSourceContent(
    headerUri: vscode.Uri
): Promise<{ success: boolean; message: string }> {
    try {
        const sourceUri = vscode.Uri.joinPath(headerUri, '..', headerUri.path.split('/').pop()!.replace('.h', '.c'));
        const doc = await vscode.workspace.openTextDocument(sourceUri);
        const content = doc.getText();
        return { success: true, message: content };
    } catch (err: any) {
        return { success: false, message: `Cannot read source: ${err.message}` };
    }
}

// ---------- 以下为 set_code_section 相关函数 ----------

/**
 * 在头文件或源文件中查找函数声明的文本范围
 * @param text 文件全文
 * @param functionName 函数名 (如 ClassName_method)
 * @param isDefinition true 查找定义 (含函数体), false 查找声明 (以分号结尾)
 * @returns 匹配到的 range，未找到返回 null
 */
function findFunctionRangeInText(text: string, functionName: string, isDefinition: boolean): vscode.Range | null {
    const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // 匹配函数签名（返回类型 + 函数名 + 参数列表）
    const signaturePattern = `(?:^|\\n)\\s*([\\w\\s*]+\\s+)${escaped}\\s*\\([^)]*\\)`;
    const regex = new RegExp(signaturePattern, 'gm');
    
    let bestRange: vscode.Range | null = null;
    let bestBodyLength = -1;
    let match;

    while ((match = regex.exec(text)) !== null) {
        const startIndex = match.index + match[0].length - match[0].trimStart().length;
        const startLine = text.substring(0, startIndex).split('\n').length - 1;
        const lineStartPos = text.lastIndexOf('\n', startIndex - 1) + 1;
        const startChar = startIndex - lineStartPos;

        // 检查签名后的字符，决定是声明还是定义
        const afterSignature = text.substring(match.index + match[0].length).trimStart();
        const firstChar = afterSignature[0];

        if (isDefinition) {
            // 定义：后面必须是 '{'，不能是 ';'
            if (firstChar !== '{') continue;

            const bodyStart = text.indexOf('{', match.index + match[0].length);
            if (bodyStart === -1) continue;
            const endIndex = findMatchingBraceInText(text, bodyStart);
            if (endIndex === -1) continue;

            const bodyLength = endIndex - bodyStart;
            // 如果有多个定义，取函数体最长的
            if (bodyLength > bestBodyLength) {
                bestBodyLength = bodyLength;
                const endLine = text.substring(0, endIndex).split('\n').length - 1;
                const endLineStart = text.lastIndexOf('\n', endIndex - 1) + 1;
                const endChar = endIndex - endLineStart + 1;
                bestRange = new vscode.Range(startLine, startChar, endLine, endChar);
            }
        } else {
            // 声明：后面必须是 ';'（可能跨行，简单检查紧接的分号）
            if (firstChar !== ';') {
                // 允许有空格或换行后出现分号
                const semiIndex = text.indexOf(';', match.index + match[0].length);
                if (semiIndex === -1) continue;
                // 确认分号前没有大括号（防止误匹配）
                const beforeSemi = text.substring(match.index + match[0].length, semiIndex);
                if (beforeSemi.includes('{')) continue;

                const endLine = text.substring(0, semiIndex).split('\n').length - 1;
                const endLineStart = text.lastIndexOf('\n', semiIndex - 1) + 1;
                const endChar = semiIndex - endLineStart + 1;
                return new vscode.Range(startLine, startChar, endLine, endChar);
            } else {
                // 分号就在签名之后
                const semiIndex = match.index + match[0].length;
                const endLine = text.substring(0, semiIndex).split('\n').length - 1;
                const endLineStart = text.lastIndexOf('\n', semiIndex - 1) + 1;
                const endChar = semiIndex - endLineStart + 1;
                return new vscode.Range(startLine, startChar, endLine, endChar);
            }
        }
    }

    return bestRange;
}

function findMatchingBraceInText(text: string, openPos: number): number {
    let depth = 1;
    for (let i = openPos + 1; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function findStructRangeInText(text: string, structName: string): vscode.Range | null {
    const escaped = structName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 匹配 typedef struct _Name { ... } Name;
    const pattern = new RegExp(`typedef\\s+struct\\s+(_${escaped}|${escaped})?\\s*\\{`, 'g');
    const match = pattern.exec(text);
    if (!match) return null;
    const startIndex = match.index;
    const openBrace = text.indexOf('{', startIndex);
    const closeBrace = findMatchingBraceInText(text, openBrace);
    if (closeBrace === -1) return null;
    // 向后寻找结构体别名和分号
    const afterBrace = text.substring(closeBrace + 1);
    const nameMatch = afterBrace.match(new RegExp(`\\b${escaped}\\b\\s*;`));
    if (!nameMatch) return null;
    const endIndex = closeBrace + 1 + nameMatch.index! + nameMatch[0].length;

    const startLine = text.substring(0, startIndex).split('\n').length - 1;
    const lineStart = text.lastIndexOf('\n', startIndex - 1) + 1;
    const startChar = startIndex - lineStart;
    const endLine = text.substring(0, endIndex).split('\n').length - 1;
    const endLineStart = text.lastIndexOf('\n', endIndex - 1) + 1;
    const endChar = endIndex - endLineStart;
    return new vscode.Range(startLine, startChar, endLine, endChar);
}

function extractSignatureFromDefinition(code: string): string {
    const firstBrace = code.indexOf('{');
    if (firstBrace === -1) return code + ';';
    return code.substring(0, firstBrace).trim() + ';';
}

/**
 * 精确替换代码区块（函数定义/结构体定义），并自动同步头文件声明
 */
export async function setCodeSection(
    headerPath: string,
    sectionName: string,
    newCode: string,
    sectionType: 'function' | 'struct' | 'auto' = 'auto'
): Promise<{ success: boolean; message: string }> {
    const sourcePath = headerPath.replace(/\.h$/, '.c');
    const headerUri = vscode.Uri.file(headerPath);
    const sourceUri = vscode.Uri.file(sourcePath);

    let sourceExists = true;
    try {
        await vscode.workspace.fs.stat(sourceUri);
    } catch {
        sourceExists = false;
    }

    const edit = new vscode.WorkspaceEdit();

    // 自动检测类型
    if (sectionType === 'auto') {
        if (newCode.includes('typedef struct')) {
            sectionType = 'struct';
        } else if (newCode.includes('{') && (newCode.includes('(') || newCode.includes(')'))) {
            sectionType = 'function';
        } else {
            return { success: false, message: '无法自动检测 sectionType，请显式指定 function 或 struct' };
        }
    }

    if (sectionType === 'struct') {
        // 只修改头文件中的结构体定义
        try {
            const headerDoc = await vscode.workspace.openTextDocument(headerUri);
            const headerText = headerDoc.getText();
            const range = findStructRangeInText(headerText, sectionName);
            if (!range) {
                return { success: false, message: `在头文件中未找到结构体 ${sectionName} 的定义` };
            }
            edit.replace(headerUri, range, newCode);
        } catch (err: any) {
            return { success: false, message: `修改头文件结构体失败: ${err.message}` };
        }
    } else {
        // 处理函数
        if (sourceExists) {
            try {
                const sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
                const sourceText = sourceDoc.getText();
                const range = findFunctionRangeInText(sourceText, sectionName, true);
                if (!range) {
                    return { success: false, message: `在源文件中未找到函数 ${sectionName} 的定义` };
                }
                edit.replace(sourceUri, range, newCode);
            } catch (err: any) {
                return { success: false, message: `修改源文件失败: ${err.message}` };
            }
        } else {
            return { success: false, message: `源文件 ${sourcePath} 不存在，无法修改函数定义` };
        }

        // 同步头文件中的声明
        try {
            const headerDoc = await vscode.workspace.openTextDocument(headerUri);
            const headerText = headerDoc.getText();
            const declRange = findFunctionRangeInText(headerText, sectionName, false);
            if (declRange) {
                const newSignature = extractSignatureFromDefinition(newCode);
                edit.replace(headerUri, declRange, newSignature);
            }
        } catch (err: any) {
            return { success: false, message: `更新头文件声明失败: ${err.message}` };
        }
    }

    const success = await vscode.workspace.applyEdit(edit);
    if (!success) {
        return { success: false, message: '应用编辑失败，可能因为文件只读或冲突' };
    }

    // 保存修改的文件
    try {
        const headerDoc = await vscode.workspace.openTextDocument(headerUri);
        await headerDoc.save();
        if (sourceExists && sectionType !== 'struct') {
            const sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
            await sourceDoc.save();
        }
    } catch (err: any) {
        return { success: false, message: `编辑已应用但保存失败: ${err.message}` };
    }

    return { success: true, message: `✅ 已更新 ${sectionName} 的${sectionType === 'struct' ? '结构体' : '函数'}` };
}