import type { Metadata } from "next";
import { Clause, LegalPage } from "@/components/legal";
import { COMPANY } from "@/lib/legal";

export const metadata: Metadata = { title: "Imprint", description: "Legal notice (Impressum) for Lead96." };

/** Legal notice required for a German company's website (Impressum, § 5 DDG). */
export default function ImprintPage() {
  return (
    <LegalPage title="Imprint (Impressum)">
      <Clause title="Provider">
        <p>
          {COMPANY.legalName}
          <br />
          {COMPANY.street}
          <br />
          {COMPANY.city}
          <br />
          {COMPANY.country}
        </p>
        <p>Represented by: {COMPANY.representative}</p>
        {COMPANY.registerNumber ? (
          <p>
            Commercial register: {COMPANY.registerCourt ? `${COMPANY.registerCourt}, ` : ""}
            {COMPANY.registerNumber}
          </p>
        ) : null}
        {COMPANY.vatId ? <p>VAT ID: {COMPANY.vatId}</p> : null}
      </Clause>
      <Clause title="Contact">
        <p>
          Email:{" "}
          <a href={`mailto:${COMPANY.email}`} className="text-brand-700 hover:underline">
            {COMPANY.email}
          </a>
        </p>
      </Clause>
      <Clause title="Responsible for content">
        <p>
          {COMPANY.representative}, {COMPANY.street}, {COMPANY.city}
        </p>
      </Clause>
    </LegalPage>
  );
}
