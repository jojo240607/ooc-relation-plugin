export function generateInterfaceHeader(interfaceName: string, methods: { returnType: string; name: string; params: string }[]): string {
    const guard = `${interfaceName.toUpperCase()}_H`;
    let methodsStr = '';
    for (const m of methods) {
        const fullParams = m.params ? `${interfaceName} *self, ${m.params}` : `${interfaceName} *self`;
        methodsStr += `    ${m.returnType} (*${m.name})(${fullParams});\n`;
    }
    if (methodsStr.length === 0) {
        methodsStr = '    /* No methods defined */\n';
    }

    return `#ifndef ${guard}
#define ${guard}

#include <stdint.h>

typedef struct _${interfaceName} ${interfaceName};

struct ${interfaceName}Vtable {
${methodsStr}};

struct _${interfaceName} {
    struct ${interfaceName}Vtable *vtable;
};

void ${interfaceName}_init(${interfaceName} *self);
void ${interfaceName}_deinit(${interfaceName} *self);

#endif /* ${guard} */
`;
}