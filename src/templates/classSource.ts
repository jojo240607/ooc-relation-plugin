export function generateSource(className: string): string {
    return `#include "${className}.h"
#include <stdlib.h>
#include <string.h>

const struct ${className}Fun ${className}_fun = {
    .destroy = ${className}_destroy,
};

${className} *${className}_create(void) {
    ${className} *self = (${className}*)malloc(sizeof(${className}));
    if (!self) return NULL;
    memset(self, 0, sizeof(${className}));
    ${className}_init(self);
    return self;
}

void ${className}_destroy(${className} *self) {
    if (!self) return;
    ${className}_deinit(self);
    free(self);
}

void ${className}_init(${className} *self) {
    if (!self) return;
    self->fun = &${className}_fun;
}

void ${className}_deinit(${className} *self) {
    if (!self) return;
}
`;
}