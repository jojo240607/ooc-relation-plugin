export function generateInterfaceSource(interfaceName: string, methods: { returnType: string; name: string; params: string }[]): string {
    let defaultImpls = '';
    let vtableAssigns = '';
    for (const m of methods) {
        const fullParams = m.params
            ? `${interfaceName} *self, ${m.params}`
            : `${interfaceName} *self`;
        const defaultReturn = m.returnType === 'void'
            ? ''
            : `static ${m.returnType} ret = {0}; return ret;`;
        defaultImpls += `
static ${m.returnType} default_${interfaceName}_${m.name}_impl(${fullParams}) {
    /* TODO: default behavior, override in subclass */
    (void)self;
    ${defaultReturn}
}
`;
        vtableAssigns += `    self->vtable->${m.name} = default_${interfaceName}_${m.name}_impl;\n`;
    }

    return `/* OOC_INTERFACE */
#include "${interfaceName}.h"
#include <stdlib.h>
#include <string.h>

${defaultImpls}
void ${interfaceName}_init(${interfaceName} *self) {
    if (!self) return;
    if (!self->vtable) {
        self->vtable = (struct ${interfaceName}Vtable*)malloc(sizeof(struct ${interfaceName}Vtable));
        if (self->vtable) {
            memset(self->vtable, 0, sizeof(struct ${interfaceName}Vtable));
        }
    }
${vtableAssigns}
}

void ${interfaceName}_deinit(${interfaceName} *self) {
    if (!self) return;
    if (self->vtable) {
        free(self->vtable);
        self->vtable = NULL;
    }
}
`;
}