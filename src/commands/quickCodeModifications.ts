import * as vscode from 'vscode';
import { addPrivateFunction, addGlobalVariable, addInclude } from '../operations/modifySourceOperations';

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