import { redirect } from "next/navigation";

/**
 * Content has merged into Studio's "Library" tab (the watermarked teaser was
 * dropped — the Library shows real content_items with an honest empty state).
 * This route stays only to redirect any old link/bookmark to Studio.
 */
export default function ContentPage() {
  redirect("/studio");
}
