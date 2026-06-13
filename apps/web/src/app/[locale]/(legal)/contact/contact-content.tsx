"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Input, Label, Textarea } from "@giga-pdf/ui";
import { Mail, Phone, MapPin, Github, Send, CheckCircle } from "lucide-react";
import { env } from "@/lib/env";

export default function ContactPage() {
  const t = useTranslations("legal.contact");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Simulate form submission
    await new Promise((resolve) => setTimeout(resolve, 1000));

    setIsSubmitting(false);
    setIsSubmitted(true);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-4xl font-bold mb-4">{t("title")}</h1>
      <p className="text-muted-foreground text-lg mb-12">{t("subtitle")}</p>

      <div className="grid gap-12 lg:grid-cols-2">
        {/* Contact Info */}
        <div>
          <h2 className="text-2xl font-semibold mb-6">{t("info.title")}</h2>

          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <Mail className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-medium">{t("info.email.title")}</h3>
                <p className="text-muted-foreground text-sm mb-1">{t("info.email.description")}</p>
                <a href={`mailto:${env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL}`} className="text-primary hover:underline">
                  {env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL}
                </a>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <Phone className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-medium">{t("info.phone.title")}</h3>
                <p className="text-muted-foreground text-sm mb-1">{t("info.phone.description")}</p>
                <a href={`tel:${env.NEXT_PUBLIC_LEGAL_PHONE.replace(/\s/g, "")}`} className="text-primary hover:underline">
                  {env.NEXT_PUBLIC_LEGAL_PHONE}
                </a>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <MapPin className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-medium">{t("info.address.title")}</h3>
                <p className="text-muted-foreground">{env.NEXT_PUBLIC_LEGAL_ADDRESS}</p>
              </div>
            </div>
          </div>

          {/* Social Links */}
          <div className="mt-10">
            <h3 className="font-medium mb-4">{t("info.social.title")}</h3>
            <div className="flex gap-4">
              <a
                href="https://github.com/QrCommunication/gigapdf"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-muted p-3 hover:bg-muted/80 transition-colors"
              >
                <Github className="h-5 w-5" />
              </a>
            </div>
          </div>

          {/* Company Info */}
          <div className="mt-10 rounded-lg border p-6">
            <h3 className="font-medium mb-4">{t("info.company.title")}</h3>
            <div className="text-sm text-muted-foreground space-y-2">
              <p><strong>{env.NEXT_PUBLIC_LEGAL_COMPANY_NAME} {env.NEXT_PUBLIC_LEGAL_COMPANY_FORM}</strong></p>
              <p>SIREN : {env.NEXT_PUBLIC_LEGAL_SIREN}</p>
              <p>{env.NEXT_PUBLIC_LEGAL_ADDRESS}</p>
            </div>
          </div>
        </div>

        {/* Contact Form */}
        <div>
          <h2 className="text-2xl font-semibold mb-6">{t("form.title")}</h2>

          {isSubmitted ? (
            <div className="rounded-lg border p-8 text-center">
              <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">{t("form.success.title")}</h3>
              <p className="text-muted-foreground">{t("form.success.description")}</p>
              <Button
                variant="outline"
                className="mt-6"
                onClick={() => setIsSubmitted(false)}
              >
                {t("form.success.newMessage")}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">{t("form.firstName")}</Label>
                  <Input
                    id="firstName"
                    name="firstName"
                    required
                    placeholder={t("form.firstNamePlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">{t("form.lastName")}</Label>
                  <Input
                    id="lastName"
                    name="lastName"
                    required
                    placeholder={t("form.lastNamePlaceholder")}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">{t("form.email")}</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder={t("form.emailPlaceholder")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="subject">{t("form.subject")}</Label>
                <Input
                  id="subject"
                  name="subject"
                  required
                  placeholder={t("form.subjectPlaceholder")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="message">{t("form.message")}</Label>
                <Textarea
                  id="message"
                  name="message"
                  required
                  rows={6}
                  placeholder={t("form.messagePlaceholder")}
                />
              </div>

              <Button type="submit" className="w-full gap-2" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    {t("form.sending")}
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    {t("form.send")}
                  </>
                )}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
