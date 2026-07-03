export function generateHeader(className: string): string {
    const guard = `${className.toUpperCase()}_H`;
    return `#ifndef ${guard}
#define ${guard}

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

typedef struct _${className} ${className};

struct ${className}Fun {
    void (*destroy)(${className} *self);
};

struct _${className} {
    const struct ${className}Fun *fun;
    /* TODO: Add member variables here */
};

${className} *${className}_create(void);
void ${className}_destroy(${className} *self);
void ${className}_init(${className} *self);
void ${className}_deinit(${className} *self);

extern const struct ${className}Fun ${className}_fun;

#endif /* ${guard} */
`;
}