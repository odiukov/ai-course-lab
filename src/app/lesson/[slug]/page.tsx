import { Reader } from "./reader";

export default async function LessonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Reader slug={slug} />;
}
