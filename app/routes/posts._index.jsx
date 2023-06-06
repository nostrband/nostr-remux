import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";

import { getPosts } from "~/models/post.server";

export const loader = async () => {
  return json({ posts: await getPosts() });
};

export default function Posts() {
  const { posts } = useLoaderData();
  console.log("posts", posts);
  return (
    <main>
      <h1>Posts</h1>
      <ul>
        {posts.map((post) => (
          <li key={post.naddr}>
            <Link
              to={post.naddr}
              className="text-blue-600 underline"
            >
              {post.naddr}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

