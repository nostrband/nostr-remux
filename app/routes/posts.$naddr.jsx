import { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { marked } from "marked";

import { getPost } from "~/models/post.server";

export const loader = async ({ params }) => {
  const post = await getPost(params.naddr);

  const html = marked(post.content);
  return json({ html, post });
};

export const meta = ({data}) => {
  return [
    { title: data.post.id },
    {
      property: "og:title",
      content: "Very cool app",
    },
    {
      name: "description",
      content: "This app is the best",
    },
  ];
}

export default function PostNaddr() {
  const { html, post } = useLoaderData();
  return (
    <main className="mx-auto max-w-4xl">
      <h1 className="my-6 border-b-2 text-center text-3xl">
        Some Post: {post.naddr}
      </h1>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
