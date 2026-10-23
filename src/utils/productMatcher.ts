// utils/productMatcher.ts
import { supabase } from '../lib/supabaseClient'; // Ensure your Supabase client is initialized here

export interface CatalogProduct {
  id: string;
  name: string;
  price: number;
}

export interface MatchedBillItem {
  name: string;
  quantity: number;
  price: number;
  isMatched: boolean;
}

/**
 * Normalizes text by stripping spaces and special characters for flexible speech matching.
 */
function normalizeString(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Matches parsed voice items against the Supabase product database.
 */
export async function matchVoiceItemsWithSupabase(
  spokenItems: { name: string; quantity: number }[]
): Promise<MatchedBillItem[]> {
  // Fetch products from your Supabase catalog
  const { data: catalog, error } = await supabase
    .from('products')
    .select('id, name, price');

  if (error || !catalog) {
    console.error('Supabase catalog fetch error:', error);
    // Fallback: Return spoken items with 0 price if database fetch fails
    return spokenItems.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      price: 0,
      isMatched: false,
    }));
  }

  return spokenItems.map((spokenItem) => {
    const cleanSpoken = normalizeString(spokenItem.name);

    // Fuzzy matching logic: checks direct containment or overlap
    const matchedProduct = catalog.find((product: CatalogProduct) => {
      const cleanCatalog = normalizeString(product.name);
      return (
        cleanCatalog.includes(cleanSpoken) ||
        cleanSpoken.includes(cleanCatalog)
      );
    });

    if (matchedProduct) {
      return {
        name: matchedProduct.name, // Use official catalog title
        quantity: spokenItem.quantity,
        price: matchedProduct.price, // Fetch exact database price
        isMatched: true,
      };
    }

    return {
      name: spokenItem.name,
      quantity: spokenItem.quantity,
      price: 0, // Needs manual price input
      isMatched: false,
    };
  });
}
