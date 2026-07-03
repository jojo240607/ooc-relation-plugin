import * as vscode from 'vscode';

// 结构体成员信息
export interface StructMember {
    line: number;
    text: string; // 完整声明行
    type: string;
    name: string;
    isPointer: boolean;
}

// 结构体信息
export interface StructInfo {
    name: string;
    startLine: number;
    endLine: number;
    bodyStart: number; // { 所在行
    bodyEnd: number;   // } 所在行
    members: StructMember[];
}

// 函数信息
export interface FunctionInfo {
    name: string;
    bodyStart: number; // 函数体开始行（大括号下一行）
    bodyEnd: number;   // 函数体结束行（大括号所在行）
}

/**
 * 从文档中解析指定名称的结构体信息
 */
// src/astUtils.ts
export function findStruct(document: vscode.TextDocument, structName: string): StructInfo | null {
    const text = document.getText();
    const lines = text.split('\n');
    const tagName = `_${structName}`;
    let matchLine = -1;
    let matchedTag = '';
    // 1. 尝试匹配 struct _ClassName
    const regexTag = new RegExp(`struct\\s+${tagName}\\s*\\{`);
    for (let i = 0; i < lines.length; i++) {
        if (regexTag.exec(lines[i])) {
            matchLine = i;
            matchedTag = tagName;
            break;
        }
    }

    // 2. 回退匹配 struct ClassName（兼容旧模板）
    if (matchLine === -1) {
        const regexNoTag = new RegExp(`struct\\s+${structName}\\s*\\{`);
        for (let i = 0; i < lines.length; i++) {
            if (regexNoTag.exec(lines[i])) {
                matchLine = i;
                matchedTag = structName;
                break;
            }
        }
    }

    if (matchLine === -1) return null;
    // 3. 从匹配行开始，定位结构体范围
    const startLine = matchLine;
    const bodyStart = matchLine; // { 所在行
    let braceCount = 0;
    let bodyEnd = matchLine;
    for (let j = matchLine; j < lines.length; j++) {
        braceCount += (lines[j].match(/\{/g) || []).length;
        braceCount -= (lines[j].match(/\}/g) || []).length;
        if (braceCount === 0) { bodyEnd = j; break; }
    }

    const members: StructMember[] = [];
    let k = bodyStart + 1;
    while (k < bodyEnd) {
      const line = lines[k].trim();
      if (line === '' || line.startsWith('//') || line.startsWith('/*') ||
          line.startsWith('*') || line.startsWith('#')) {
        k++;
        continue;
      }
      // 合并 union/struct 嵌套块
      if ((line.startsWith('union') || line.startsWith('struct')) &&
          line.includes('{')) {
        let nestBrace = 0;
        let nestEnd = k;
        for (let n = k; n <= bodyEnd; n++) {
          nestBrace += (lines[n].match(/\{/g) || []).length;
          nestBrace -= (lines[n].match(/\}/g) || []).length;
          if (nestBrace === 0) {
            nestEnd = n;
            break;
          }
        }
        const nestedText = lines.slice(k, nestEnd + 1).join('\n').trim();
        members.push({
          line: k,
          text: nestedText,
          type: '',  // 留空，getParentClassName 会通过 text.startsWith('union')
                     // 处理
          name: '',
          isPointer: false
        });
        k = nestEnd + 1;
        continue;
      }
      const member = parseMemberLine(line, k);
      if (member.type || member.name) members.push(member);
      k++;
    }

    return {
      name: structName,
      startLine,
      endLine: bodyEnd,
      bodyStart,
      bodyEnd,
      members
    };
}
function parseMemberLine(line: string, lineNumber: number): StructMember {
    const cleanLine = line.replace(/;.*$/, '').trim();
    const parts = cleanLine.split(/\s+/);
    if (parts.length >= 2) {
        const lastPart = parts[parts.length - 1];
        const type = parts.slice(0, -1).join(' ');
        const isPointer = lastPart.startsWith('*');
        const name = isPointer ? lastPart.substring(1) : lastPart;
        return { line: lineNumber, text: line, type, name, isPointer };
    }
    return { line: lineNumber, text: line, type: '', name: '', isPointer: false };
}
/**
 * 获取父类名称（跳过指针成员，如 vtable 和 fun 指针）
 */
export function getParentClassName(struct: StructInfo, document: vscode.TextDocument): string | null {
    const basicTypes = new Set([
        'int', 'float', 'double', 'char', 'short', 'long',
        'unsigned', 'signed', 'void', 'size_t',
        'uint8_t', 'int8_t', 'uint16_t', 'int16_t',
        'uint32_t', 'int32_t', 'bool', '_Bool'
    ]);

    function extractTypeFromDecl(decl: string): string | null {
        const parts = decl.trim().split(/\s+/);
        if (parts.length < 2) return null;
        const varName = parts[parts.length - 1].replace(/^\*/, '');
        const typeParts = parts.slice(0, -1);
        return typeParts.join(' ').replace(/\*$/, '').trim();
    }

    for (const member of struct.members) {
        if (member.isPointer) continue;

        const text = member.text.trim();
        if (text.startsWith('union')) {
            const unionBodyMatch = text.match(/union\s*\{(.+)\}/);
            if (unionBodyMatch) {
                const unionBody = unionBodyMatch[1];
                const innerMembers = unionBody.split(';').filter(s => s.trim().length > 0);
                for (const inner of innerMembers) {
                    const decl = inner.trim();
                    if (decl.includes('*')) continue; // 跳过指针成员
                    const type = extractTypeFromDecl(decl);
                    if (type && !basicTypes.has(type.replace(/^const\s+/, ''))) {
                        if (type.startsWith('struct ')) {
                            return type.substring('struct '.length);
                        }
                        return type;
                    }
                }
            }
            continue;
        }

        const type = member.type.trim().replace(/^const\s+/, '');
        if (basicTypes.has(type)) continue;
        if (type.startsWith('struct ')) {
            return type.substring('struct '.length);
        }
        return type;
    }
    return null;
}



/**
 * 检查是否存在完整的虚表结构体（xxxVtable 定义）
 */
export function hasVtableStruct(document: vscode.TextDocument, className: string): boolean {
    const text = document.getText();
    const regex = new RegExp(`struct\\s+${escapeRegExp(className)}Vtable\\s*\\{`, 'g');
    return regex.test(text);
}

/**
 * 获取虚函数列表（从虚表结构体中解析）
 */
export function getVirtualMethods(document: vscode.TextDocument, className: string): { returnType: string; name: string; params: string }[] {
    const text = document.getText();
    const vtableName = `${className}Vtable`;
    const regex = new RegExp(`struct\\s+${escapeRegExp(vtableName)}\\s*\\{([^}]*)\\}`, 's');
    const match = regex.exec(text);
    if (!match) return [];

    const body = match[1];
    const results: { returnType: string; name: string; params: string }[] = [];
    const funcRegex = /(\w[\w\s*]+)\s+\(\*\s*(\w+)\s*\)\s*\(([^)]*)\)\s*;/g;
    let funcMatch;
    while ((funcMatch = funcRegex.exec(body)) !== null) {
        results.push({
            returnType: funcMatch[1].trim(),
            name: funcMatch[2],
            params: funcMatch[3].trim()
        });
    }
    return results;
}

/**
 * 查找函数定义（简单匹配函数体）
 */
export function findFunction(document: vscode.TextDocument, funcName: string): FunctionInfo | null {
    const text = document.getText();
    const regex = new RegExp(`(\\w+\\s+)?${escapeRegExp(funcName)}\\s*\\([^)]*\\)\\s*\\{`, 'g');
    const match = regex.exec(text);
    if (!match) return null;

    const startPos = match.index;
    let braceCount = 1;
    let endPos = startPos + match[0].length;
    for (; endPos < text.length; endPos++) {
        if (text[endPos] === '{') braceCount++;
        else if (text[endPos] === '}') braceCount--;
        if (braceCount === 0) break;
    }

    const bodyStartLine = document.positionAt(startPos + match[0].length).line;
    const bodyEndLine = document.positionAt(endPos).line;

    return {
        name: funcName,
        bodyStart: bodyStartLine,
        bodyEnd: bodyEndLine
    };
}

/**
 * 在整个工作区查找某个类名的头文件路径（简单实现，扫描 .h 文件）
 */
//export async function findHeaderUri(className: string, workspaceUri: vscode.Uri): Promise<vscode.Uri | null> {
//    const pattern = new vscode.RelativePattern(workspaceUri, `**/${className}.h`);
//    const files = await vscode.workspace.findFiles(pattern, null, 1);
//    return files.length > 0 ? files[0] : null;
//}

// 辅助：转义正则特殊字符
function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


/**
 * 向结构体末尾插入新成员
 */
export async function insertStructMember(
    document: vscode.TextDocument,
    structName: string,
    memberText: string
): Promise<void> {
    const struct = findStruct(document, structName);
    if (!struct) return;
    const edit = new vscode.WorkspaceEdit();
    let insertLine: number;
    let baseIndent: string;
    if (struct.members.length > 0) {
        const lastMember = struct.members[struct.members.length - 1];
        insertLine = lastMember.line + 1;
    } else {
        insertLine = struct.bodyStart + 1;
    }
    const structLine = document.lineAt(struct.startLine).text;
    const indentMatch = structLine.match(/^(\s*)/);
    const structIndent = indentMatch ? indentMatch[0].length : 0;
    baseIndent = ' '.repeat(structIndent + 4);
    const pos = new vscode.Position(insertLine, 0);
    edit.insert(document.uri, pos, `${baseIndent}${memberText}\n`);
    await vscode.workspace.applyEdit(edit);
}


/**
 * 在最后一个 #include 之后插入文本
 */
export async function insertAfterIncludes(
    document: vscode.TextDocument,
    text: string
): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    let insertLine = 0;
    for (let i = 0; i < document.lineCount; i++) {
        const lineText = document.lineAt(i).text.trim();
        if (lineText.startsWith('#include')) {
            insertLine = i + 1;
        }
    }
    const pos = new vscode.Position(insertLine, 0);
    edit.insert(document.uri, pos, text + '\n');
    await vscode.workspace.applyEdit(edit);
}

/**
 * 在文件末尾追加文本
 */
export async function insertAtEndOfFile(
    document: vscode.TextDocument,
    text: string
): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    const lastLine = document.lineAt(document.lineCount - 1);
    const pos = new vscode.Position(lastLine.lineNumber + 1, 0);
    edit.insert(document.uri, pos, `\n${text}`);
    await vscode.workspace.applyEdit(edit);
}

/**
 * 在函数体结束 '}' 之前插入一行文本（自动缩进）
 */
export async function insertBeforeFunctionEnd(
    document: vscode.TextDocument,
    funcName: string,
    text: string
): Promise<void> {
    const func = findFunction(document, funcName);
    if (!func) throw new Error(`Function '${funcName}' not found`);
    let indent = '    ';
    for (let i = func.bodyStart + 1; i < func.bodyEnd; i++) {
        const lineText = document.lineAt(i).text;
        if (lineText.trim() !== '') {
            const match = lineText.match(/^(\s*)/);
            if (match && match[0].length > 0) {
                indent = match[0];
            }
            break;
        }
    }
    const insertPos = new vscode.Position(func.bodyEnd, 0);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, insertPos, `${indent}${text}\n`);
    await vscode.workspace.applyEdit(edit);
}

/**
 * 判断结构体是否有 vtable 指针字段
 * 
 */
/**
 * 检查结构体是否有虚表（通过查找成员中是否有名为 vtable 的指针）
 */
//export function hasVtableField(structInfo: StructInfo, document: vscode.TextDocument): boolean {
//    return structInfo.members.some(m => m.name === 'vtable');
//}
export function hasVtableField(struct: StructInfo): boolean {
    for (const member of struct.members) {
        // 普通成员：vtable 或 _vtable 指针
        if ((member.name === 'vtable' || member.name === '_vtable') && member.isPointer) {
            return true;
        }
        // union 成员：检查内部是否包含 vtable 指针
        if (member.text.includes('union')) {
            const unionMatch = member.text.match(/union\s*\{([^}]+)\}/);
            if (unionMatch) {
                const inner = unionMatch[1];
                // 简单判断内部有 *vtable 或 * vtable 字样
                if (/\*\s*vtable\b/.test(inner) || /\bvtable\s*\*/.test(inner)) {
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * 在结构体的第一个成员之前插入一行文本（保持缩进）
 */
export async function insertBeforeFirstMember(
    document: vscode.TextDocument,
    struct: StructInfo,
    text: string
): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    let insertLine: number;
    if (struct.members.length > 0) {
        // 插入在第一个成员行之前
        insertLine = struct.members[0].line;
    } else {
        // 空成员列表，插入在 bodyStart 下一行
        insertLine = struct.bodyStart + 1;
    }
    const structLine = document.lineAt(struct.startLine).text;
    const indentMatch = structLine.match(/^(\s*)/);
    const structIndent = indentMatch ? indentMatch[0].length : 0;
    const indent = ' '.repeat(structIndent + 4);
    const pos = new vscode.Position(insertLine, 0);
    edit.insert(document.uri, pos, `${indent}${text}\n`);
    await vscode.workspace.applyEdit(edit);
}

/**
 * 替换结构体的第一个成员（用于将父类成员改为 union）
 */
export async function replaceFirstMember(
    document: vscode.TextDocument,
    struct: StructInfo,
    newMemberText: string
): Promise<void> {
    if (struct.members.length === 0) {
        await insertStructMember(document, struct.name, newMemberText);
        return;
    }
    const firstMember = struct.members[0];
    const line = firstMember.line;
    const oldLine = document.lineAt(line).text;
    const indentMatch = oldLine.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[0] : '    ';
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(line, 0, line, oldLine.length), `${indent}${newMemberText}`);
    await vscode.workspace.applyEdit(edit);
}

/**
 * 在指定结构体定义之前插入文本
 */
export async function insertBeforeStruct(
    document: vscode.TextDocument,
    structName: string,
    text: string
): Promise<void> {
    const struct = findStruct(document, structName);
    if (!struct) throw new Error(`Struct ${structName} not found`);
    const pos = new vscode.Position(struct.startLine, 0);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, pos, text + '\n');
    await vscode.workspace.applyEdit(edit);
}

/**
 * 查找类的 Fun 结构体（例如 ClassNameFun）
 */
export function findFunStruct(document: vscode.TextDocument, className: string): StructInfo | null {
    const funName = `${className}Fun`;
    return findStruct(document, funName);
}

/**
 * 获取当前类的普通方法（Fun 结构体中除 create/destroy 外的函数指针）
 */
export function getRegularMethods(document: vscode.TextDocument, className: string): { returnType: string; name: string; params: string }[] {
    const funStruct = findFunStruct(document, className);
    if (!funStruct) return [];
    const methods: { returnType: string; name: string; params: string }[] = [];
    const exclude = new Set(['destroy']);
    for (const member of funStruct.members) {
        if (exclude.has(member.name)) continue;
        const match = member.text.match(/([\w\s\*]+?)\s+\(\*(\w+)\)\s*\(([^)]*)\)/);
        if (match) {
            methods.push({
                returnType: match[1].trim(),
                name: match[2],
                params: match[3].trim()
            });
        }
    }
    return methods;
}

/**
 * 向 Fun 结构体末尾插入一个新的函数指针成员
 */
export async function insertFunMember(
    document: vscode.TextDocument,
    className: string,
    memberDecl: string
): Promise<void> {
    const funName = `${className}Fun`;
    await insertStructMember(document, funName, memberDecl);
}

/**
 * 在 ClassName_fun 初始化列表的末尾（}; 之前）插入一条初始化赋值
 */
export async function insertFunInit(
    document: vscode.TextDocument,
    className: string,
    memberName: string,
    funcName: string
): Promise<void> {
    const text = document.getText();
    const regex = new RegExp(
        `const\\s+struct\\s+${className}Fun\\s+${className}_fun\\s*=\\s*\\{([^}]*)\\};`, 's'
    );
    const match = regex.exec(text);
    if (!match) throw new Error(`Cannot find ${className}_fun initialization`);

    const body = match[1];
    const lines = body.split('\n').filter(line => line.trim().length > 0);
    const entries = lines.map(line => line.trim()).filter(line => line.startsWith('.'));

    // 检查是否已存在该成员，避免重复添加
    if (entries.some(e => e.startsWith(`.${memberName}`))) return;

    entries.push(`.${memberName} = ${funcName},`);

    // 获取缩进（基于第一个有效条目）
    let indent = '    ';
    if (lines.length > 0) {
        const firstLine = lines[0];
        const m = firstLine.match(/^(\s*)/);
        if (m) indent = m[1];
    }

    const newBody = '\n' + entries.map(e => `${indent}${e}`).join('\n') + '\n';
    const newBlock = `const struct ${className}Fun ${className}_fun = {${newBody}};`;

    const startPos = match.index;
    const endPos = match.index + match[0].length;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
        document.uri,
        new vscode.Range(document.positionAt(startPos), document.positionAt(endPos)),
        newBlock
    );
    await vscode.workspace.applyEdit(edit);
}

/**
 * 提取 Fun 结构体中定义的函数指针（对外接口）
 * 例如 struct MotorFun { Motor* (*create)(void); ... } 返回 create, destroy 等
 */
export function getFunMethods(document: vscode.TextDocument, className: string): { returnType: string; name: string; params: string }[] {
    const funStructName = `${className}Fun`;
    const structInfo = findStruct(document, funStructName);
    if (!structInfo) return [];

    const methods: { returnType: string; name: string; params: string }[] = [];
    for (const member of structInfo.members) {
        // 匹配返回类型 (*名称)(参数列表)
        const match = member.text.match(/([\w\s\*]+?)\s+\(\*(\w+)\)\s*\(([^)]*)\)/);
        if (match) {
            methods.push({
                returnType: match[1].trim(),
                name: match[2],
                params: match[3].trim()
            });
        }
    }
    return methods;
}