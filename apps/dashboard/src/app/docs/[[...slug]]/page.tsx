import { source } from "@/lib/source";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <article className="docs-prose max-w-3xl">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[hsl(168_40%_36%)]">
        Docs
      </p>
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
        {page.data.title}
      </h1>
      {page.data.description ? (
        <p className="mt-3 text-lg text-[hsl(210_12%_40%)]">{page.data.description}</p>
      ) : null}
      <div className="mt-8">
        <MDX />
      </div>
    </article>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();
  return {
    title: `${page.data.title} — Trainfabric Docs`,
    description: page.data.description,
  };
}
