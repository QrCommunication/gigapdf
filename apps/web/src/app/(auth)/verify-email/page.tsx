import { VerifyEmailForm } from "@/components/auth/verify-email-form";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Verify Email",
  description: "Verify your email address to activate your GigaPDF account",
};

export default function VerifyEmailPage() {
  return <VerifyEmailForm />;
}
