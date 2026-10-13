import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";
import { InboxRunner } from "@/components/inbox/InboxRunner";
import { fontFaceCss } from "@/lib/render/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "BookStudio",
  description: "Open-source, AI-automated publishing studio for Amazon KDP print books",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: fontFaceCss() }} />
      </head>
      <body>
        <a href="#main" className="sr-only">
          Skip to content
        </a>
        <div className="shell">
          <Sidebar />
          <InboxRunner />
          <main id="main" className="main">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
