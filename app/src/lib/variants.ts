// Tiny cva-style variant helper — no deps.
// Mirrors the surface of class-variance-authority for our needs.
import { cn } from "@/lib/utils";

type VariantMap = Record<string, Record<string, string>>;
type VariantKeys<V extends VariantMap> = { [K in keyof V]?: keyof V[K] };

interface Config<V extends VariantMap> {
  base?: string;
  variants: V;
  defaultVariants?: VariantKeys<V>;
}

export function tv<V extends VariantMap>(config: Config<V>) {
  return (props?: VariantKeys<V> & { className?: string }) => {
    const out: string[] = [];
    if (config.base) out.push(config.base);
    for (const key of Object.keys(config.variants) as (keyof V)[]) {
      const chosen =
        (props?.[key] as string | undefined) ??
        (config.defaultVariants?.[key] as string | undefined);
      if (chosen != null) {
        const cls = config.variants[key][chosen];
        if (cls) out.push(cls);
      }
    }
    if (props?.className) out.push(props.className);
    return cn(...out);
  };
}
