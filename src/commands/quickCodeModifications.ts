import * as vscode from 'vscode';
import { addPrivateFunction, addGlobalVariable, addInclude, setCodeSection } from '../operations/modifySourceOperations';
import { modifyFunctionBody } from '../operations/modifySourceOperations';

export async function quickAddPrivateFunction(
    headerUri: vscode.Uri,
    returnType: string,
    funcName: string,
    params: string,
    body: string
): Promise<{ success: boolean; message: string }> {
    return await addPrivateFunction(headerUri, returnType, funcName, params, body);
}

export async function quickAddGlobalVariable(
    headerUri: vscode.Uri,
    type: string,
    name: string,
    initialValue?: string
): Promise<{ success: boolean; message: string }> {
    return await addGlobalVariable(headerUri, type, name, initialValue);
}

export async function quickAddInclude(
    headerUri: vscode.Uri,
    includePath: string
): Promise<{ success: boolean; message: string }> {
    return await addInclude(headerUri, includePath);
}


export async function quickSetCodeSection(
    headerPath: string,
    sectionName: string,
    newCode: string,
    sectionType: 'function' | 'struct' | 'auto' = 'auto'
): Promise<{ success: boolean; message: string }> {
    return await setCodeSection(headerPath, sectionName, newCode, sectionType);
}

export async function quickModifyFunction(
    headerUri: vscode.Uri,
    functionName: string,
    codeContent: string,
    mode: 'replace' | 'append' = 'append'
): Promise<{ success: boolean; message: string }> {
    return await modifyFunctionBody(headerUri, functionName, codeContent, mode);
}