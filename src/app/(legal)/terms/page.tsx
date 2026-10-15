import type { Metadata } from "next";
import Link from "next/link";
import { Clause, LegalPage, List } from "@/components/legal";
import { COMPANY } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms", description: "Terms of use for Lead96, including the SMS terms." };

export default function TermsPage() {
  const mail = <a href={`mailto:${COMPANY.email}`} className="text-brand-700 hover:underline">{COMPANY.email}</a>;
  return (
    <LegalPage
      title="Terms"
      intro={
        <p>
          These terms apply to {COMPANY.brand} ({COMPANY.website}), operated by {COMPANY.legalName}, {COMPANY.street}, {COMPANY.city}, {COMPANY.country}. They
          cover contractors who use the app, and people who contact a contractor through a page, form, phone number or text message run on{" "}
          {COMPANY.brand}. Contractors may also have a separate written agreement with us; where it differs, that agreement applies.
        </p>
      }
    >
      <Clause title="1. The service">
        <p>
          {COMPANY.brand} helps home-service contractors receive customer requests, answer them with an automated AI phone and text assistant, schedule
          visits and see which advertising brings customers. The contractor, not {COMPANY.brand}, provides the actual service (for example the repair) and
          is responsible for it.
        </p>
      </Clause>

      <Clause title="2. AI assistant and recordings">
        <p>
          Calls and texts may be handled by an automated AI assistant acting for the contractor. The assistant says that it is an AI assistant, and calls
          may be recorded. Information the assistant gives (for example an available visit window) is confirmed by the contractor; prices and diagnoses
          are only given by the contractor.
        </p>
      </Clause>

      <Clause title="3. SMS terms" id="sms">
        <List
          items={[
            <>
              <b>What you get:</b> after you ask a contractor for service and agree to be contacted, you may receive text messages from that contractor&apos;s{" "}
              {COMPANY.brand} number about your request: follow-ups after a missed call, questions about the job, and scheduling, confirmations and reminders
              for your appointment. You can reply to these messages.
            </>,
            <><b>Frequency:</b> message frequency varies with your request (usually a few messages).</>,
            <><b>Costs:</b> message and data rates may apply, according to your mobile plan.</>,
            <><b>Opt out:</b> reply <b>STOP</b> at any time to stop messages. You will receive one message confirming that you are unsubscribed.</>,
            <><b>Help:</b> reply <b>HELP</b> for help, or write to {mail}.</>,
            <><b>Consent:</b> agreeing to texts is not a condition of any purchase.</>,
            "Carriers are not liable for delayed or undelivered messages.",
            <>
              Your phone number and consent are not shared with third parties for their marketing. See the{" "}
              <Link href="/privacy#sms" className="text-brand-700 hover:underline">
                Privacy Policy
              </Link>
              .
            </>,
          ]}
        />
      </Clause>

      <Clause title="4. Contractors' responsibilities">
        <List
          items={[
            "Give true information about your business, services, area and prices.",
            "Keep the content of your landing pages and ads lawful, accurate and in line with Google and Meta advertising policies. We may review, pause or remove pages or campaigns that are misleading or put our platform or ad accounts at risk.",
            "Only contact people who asked for your service and agreed to be contacted, and honour every opt-out.",
            "Keep your account sign-in safe and give team members only the access they need.",
          ]}
        />
      </Clause>

      <Clause title="5. Acceptable use">
        <p>
          Do not use {COMPANY.brand} to send spam, to contact people without their consent, to mislead or harass anyone, to break the law, or to try to
          access other businesses&apos; data or disrupt the service.
        </p>
      </Clause>

      <Clause title="6. Availability and changes">
        <p>
          We work to keep {COMPANY.brand} available and secure but cannot promise it will be free of interruptions or errors. We may improve or change
          features. We will tell contractors about important changes.
        </p>
      </Clause>

      <Clause title="7. Liability">
        <p>
          To the extent the law allows, {COMPANY.legalName} is not liable for indirect or consequential losses, or for the services contractors provide.
          Nothing in these terms limits liability that cannot be limited by law.
        </p>
      </Clause>

      <Clause title="8. Privacy">
        <p>
          How we handle personal information is described in the{" "}
          <Link href="/privacy" className="text-brand-700 hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </Clause>

      <Clause title="9. Contact">
        <p>
          {COMPANY.legalName}, {COMPANY.street}, {COMPANY.city}, {COMPANY.country}, {mail}.
        </p>
      </Clause>
    </LegalPage>
  );
}
