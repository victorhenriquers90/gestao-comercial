import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  /*
    Hover "levanta" o botao (translate-y + shadow-soft -> shadow-pop, o
    mesmo token que dropdown/dialog/sheet ja usam pra elevacao) em vez de so
    clarear a cor -- opacity sozinho deixa um botao solido com cara de
    desbotado. active desfaz a elevacao (volta pro chao) por cima do
    scale-98 que ja existia, pra ler como "pressionar", nao so "encolher".
  */
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[opacity,transform,background-color,color,box-shadow,filter] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98] active:translate-y-0 active:shadow-none active:duration-75",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-soft hover:-translate-y-px hover:shadow-pop hover:brightness-110",
        secondary: "bg-secondary text-secondary-foreground hover:-translate-y-px hover:bg-secondary/80",
        // hover:border-primary/40: so bg-muted no hover ficava neutro demais
        // perto dos outros variantes, que agora todos reagem com a cor da
        // marca -- um toque de verde na borda junta o outline ao resto sem
        // precisar preencher o fundo inteiro (continua "baixa enfase").
        outline:
          "border border-border bg-card text-foreground hover:-translate-y-px hover:border-primary/40 hover:bg-muted hover:shadow-soft",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive:
          "bg-destructive text-destructive-foreground shadow-soft hover:-translate-y-px hover:shadow-pop hover:brightness-110",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 rounded-sm px-3 text-xs",
        lg: "h-12 rounded-lg px-5 text-base",
        // Circular, nao squircle: convencao comum pra botao so-icone (menu,
        // notificacao, tema) em interfaces atuais -- lia como um "toque"
        // discreto, nao como um mini-botao de texto sem texto.
        icon: "size-10 rounded-full",
        "icon-sm": "size-8 rounded-full",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />
  );
}

export { buttonVariants };
