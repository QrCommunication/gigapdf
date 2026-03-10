import { Download, FileText, CheckCircle, Clock, XCircle } from "lucide-react";
import { useInvoices } from "../hooks";
import type { Invoice } from "../types";

interface InvoiceListProps {
  className?: string;
}

export function InvoiceList({ className }: InvoiceListProps) {
  const { data: invoices, isLoading, error } = useInvoices();

  if (isLoading) {
    return (
      <div className={`space-y-3 ${className}`}>
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 animate-pulse rounded-full bg-gray-200" />
                <div>
                  <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
                  <div className="mt-2 h-3 w-48 animate-pulse rounded bg-gray-200" />
                </div>
              </div>
              <div className="h-8 w-24 animate-pulse rounded bg-gray-200" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-lg border border-red-200 bg-red-50 p-6 ${className}`}>
        <div className="flex items-center gap-3">
          <XCircle className="h-6 w-6 text-red-600" />
          <div>
            <p className="font-semibold text-red-900">Error loading invoices</p>
            <p className="text-sm text-red-700">{error.message}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!invoices || invoices.length === 0) {
    return (
      <div className={`rounded-lg border border-gray-200 bg-white p-6 ${className}`}>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <FileText className="mb-3 h-12 w-12 text-gray-400" />
          <p className="text-gray-600">No invoices yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Your invoices will appear here once you subscribe to a paid plan
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <h3 className="mb-4 text-lg font-semibold text-gray-900">Invoice History</h3>
      {invoices.map((invoice) => (
        <InvoiceItem key={invoice.id} invoice={invoice} />
      ))}
    </div>
  );
}

interface InvoiceItemProps {
  invoice: Invoice;
}

function InvoiceItem({ invoice }: InvoiceItemProps) {
  const statusConfig = getInvoiceStatusConfig(invoice.status);

  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md">
      <div className="flex items-center gap-4">
        <div className={`rounded-lg p-3 ${statusConfig.bgClass}`}>
          {statusConfig.icon}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="font-semibold text-gray-900">
              Invoice #{invoice.number || invoice.id.slice(0, 8)}
            </p>
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusConfig.badgeClass}`}>
              {statusConfig.label}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            {new Date(invoice.created).toLocaleDateString()} •{" "}
            {new Intl.NumberFormat("fr-FR", {
              style: "currency",
              currency: invoice.currency.toUpperCase(),
            }).format(invoice.amountDue / 100)}
          </p>
          {invoice.dueDate && invoice.status === "open" && (
            <p className="mt-1 text-xs text-orange-600">
              Due: {new Date(invoice.dueDate).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {invoice.hostedInvoiceUrl && (
          <a
            href={invoice.hostedInvoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            View
          </a>
        )}
        {invoice.pdfUrl && (
          <a
            href={invoice.pdfUrl}
            download
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            <Download className="h-4 w-4" />
            PDF
          </a>
        )}
      </div>
    </div>
  );
}

function getInvoiceStatusConfig(status: string) {
  switch (status) {
    case "paid":
      return {
        label: "Paid",
        icon: <CheckCircle className="h-6 w-6 text-green-600" />,
        bgClass: "bg-green-100",
        badgeClass: "bg-green-100 text-green-800",
      };
    case "open":
      return {
        label: "Open",
        icon: <Clock className="h-6 w-6 text-orange-600" />,
        bgClass: "bg-orange-100",
        badgeClass: "bg-orange-100 text-orange-800",
      };
    case "void":
      return {
        label: "Void",
        icon: <XCircle className="h-6 w-6 text-gray-600" />,
        bgClass: "bg-gray-100",
        badgeClass: "bg-gray-100 text-gray-800",
      };
    case "uncollectible":
      return {
        label: "Uncollectible",
        icon: <XCircle className="h-6 w-6 text-red-600" />,
        bgClass: "bg-red-100",
        badgeClass: "bg-red-100 text-red-800",
      };
    case "draft":
    default:
      return {
        label: "Draft",
        icon: <FileText className="h-6 w-6 text-blue-600" />,
        bgClass: "bg-blue-100",
        badgeClass: "bg-blue-100 text-blue-800",
      };
  }
}
