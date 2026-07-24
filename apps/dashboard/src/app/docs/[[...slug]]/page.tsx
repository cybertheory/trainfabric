import { source } from "@/lib/source";
import { FumaDocPage } from "@/components/fuma-doc-page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDXContent = page.data.body;

  return (
    <FumaDocPage
      title={page.data.title}
      description={page.data.description}
      toc={page.data.toc}
    >
      <MDXContent />
    </FumaDocPage>
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
