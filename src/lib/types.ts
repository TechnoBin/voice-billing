export type Product = { id: string; name: string; price: number; aliases: string[]; category?: string };
export type CartItem = { product: Product; quantity: number };
export type Bill = { id: string; createdAt: string; items: { name: string; price: number; quantity: number }[]; total: number; status: "saved" | "draft" };
