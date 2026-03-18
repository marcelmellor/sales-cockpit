import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { DevToggle } from "@/components/DevToggle";

export const metadata: Metadata = {
  title: "Sales Canvas - HubSpot Deal Visualization",
  description: "Visualisieren Sie Ihre HubSpot-Deals als interaktives Sales Canvas",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>
          {children}
          <DevToggle />
        </Providers>
      </body>
    </html>
  );
}
