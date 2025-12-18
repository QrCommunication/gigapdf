# Billing API Documentation / Documentation API Facturation

Complete API documentation for Stripe billing integration.

Documentation complète de l'API pour l'intégration de facturation Stripe.

---

## Table of Contents / Table des matières

1. [Overview / Aperçu](#overview--aperçu)
2. [Authentication / Authentification](#authentication--authentification)
3. [Trial Period / Période d'essai](#trial-period--période-dessai)
4. [Subscription Endpoints / Endpoints d'abonnement](#subscription-endpoints--endpoints-dabonnement)
5. [Checkout & Portal / Checkout et Portail](#checkout--portal--checkout-et-portail)
6. [Plans / Forfaits](#plans--forfaits)
7. [Invoices / Factures](#invoices--factures)
8. [Payment Methods / Moyens de paiement](#payment-methods--moyens-de-paiement)
9. [Usage / Utilisation](#usage--utilisation)
10. [Webhooks](#webhooks)

---

## Overview / Aperçu

**EN**: The Billing API allows you to manage subscriptions, payment methods, and invoices for your GigaPDF account. For organization (tenant) members, billing is managed at the organization level - only the owner can modify subscription and payment settings.

**FR**: L'API de facturation vous permet de gérer les abonnements, les moyens de paiement et les factures de votre compte GigaPDF. Pour les membres d'une organisation (tenant), la facturation est gérée au niveau de l'organisation - seul le propriétaire peut modifier les paramètres d'abonnement et de paiement.

### Base URL / URL de base
```
https://giga-pdf.com/api/v1/billing
```

### Response Format / Format de réponse

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2025-01-15T10:30:00Z"
  }
}
```

---

## Authentication / Authentification

**EN**: All billing endpoints require JWT authentication via the `Authorization` header.

**FR**: Tous les endpoints de facturation nécessitent une authentification JWT via l'en-tête `Authorization`.

```
Authorization: Bearer <your_jwt_token>
```

---

## Trial Period / Période d'essai

**EN**: GigaPDF offers a 14-day free trial for Starter and Pro plans:
- Trial can only be used once per user/organization
- During trial, you can switch between plans without payment
- No credit card required to start trial
- Billing starts automatically after 14 days

**FR**: GigaPDF offre une période d'essai gratuite de 14 jours pour les forfaits Starter et Pro :
- L'essai ne peut être utilisé qu'une fois par utilisateur/organisation
- Pendant l'essai, vous pouvez changer de forfait sans paiement
- Aucune carte bancaire requise pour commencer l'essai
- La facturation commence automatiquement après 14 jours

---

## Subscription Endpoints / Endpoints d'abonnement

### Get Current Subscription / Obtenir l'abonnement actuel

**EN**: Get the current subscription status.

**FR**: Obtenir le statut de l'abonnement actuel.

```
GET /billing/subscription
```

#### Response / Réponse

```json
{
  "success": true,
  "data": {
    "status": "active",
    "current_plan": "starter",
    "plan_name": "Starter",
    "billing_cycle": "month",
    "current_period_end": "2025-02-15T10:30:00Z",
    "cancel_at_period_end": false,
    "is_in_trial": false,
    "trial_days_remaining": 0,
    "has_used_trial": true,
    "billing_entity_type": "user"
  }
}
```

#### Examples / Exemples

**cURL**
```bash
# EN: Get current subscription
# FR: Obtenir l'abonnement actuel
curl -X GET "https://giga-pdf.com/api/v1/billing/subscription" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Python**
```python
# EN: Get current subscription
# FR: Obtenir l'abonnement actuel
import requests

response = requests.get(
    "https://giga-pdf.com/api/v1/billing/subscription",
    headers={"Authorization": "Bearer YOUR_JWT_TOKEN"}
)

subscription = response.json()["data"]
print(f"Plan: {subscription['current_plan']}")
print(f"Status: {subscription['status']}")

if subscription.get('is_in_trial'):
    print(f"Trial ends in {subscription['trial_days_remaining']} days")
```

**JavaScript**
```javascript
// EN: Get current subscription
// FR: Obtenir l'abonnement actuel
const response = await fetch('https://giga-pdf.com/api/v1/billing/subscription', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN'
  }
});

const { data: subscription } = await response.json();
console.log(`Plan: ${subscription.current_plan}`);
console.log(`Status: ${subscription.status}`);

if (subscription.is_in_trial) {
  console.log(`Trial ends in ${subscription.trial_days_remaining} days`);
}
```

**PHP**
```php
<?php
// EN: Get current subscription
// FR: Obtenir l'abonnement actuel

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://giga-pdf.com/api/v1/billing/subscription');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Authorization: Bearer YOUR_JWT_TOKEN'
]);

$response = curl_exec($ch);
curl_close($ch);

$data = json_decode($response, true);
$subscription = $data['data'];

echo "Plan: " . $subscription['current_plan'] . "\n";
echo "Status: " . $subscription['status'] . "\n";

if ($subscription['is_in_trial']) {
    echo "Trial ends in " . $subscription['trial_days_remaining'] . " days\n";
}
?>
```

---

### Start Free Trial / Démarrer l'essai gratuit

**EN**: Start a 14-day free trial for a plan.

**FR**: Démarrer une période d'essai gratuite de 14 jours pour un forfait.

```
POST /billing/trial/start
```

#### Request Body / Corps de la requête

```json
{
  "plan_id": "starter"
}
```

| Field / Champ | Type | Required / Requis | Description |
|--------------|------|-------------------|-------------|
| `plan_id` | string | Yes / Oui | Plan slug: "starter" or "pro" / Slug du forfait: "starter" ou "pro" |

#### Response / Réponse

```json
{
  "success": true,
  "data": {
    "message": "Trial started successfully for Starter plan",
    "plan": "starter",
    "trial_start": "2025-01-15T10:30:00Z",
    "trial_ends": "2025-01-29T10:30:00Z",
    "trial_days": 14
  }
}
```

#### Examples / Exemples

**cURL**
```bash
# EN: Start a free trial for the Starter plan
# FR: Démarrer un essai gratuit pour le forfait Starter
curl -X POST "https://giga-pdf.com/api/v1/billing/trial/start" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"plan_id": "starter"}'
```

**Python**
```python
# EN: Start a free trial for the Starter plan
# FR: Démarrer un essai gratuit pour le forfait Starter
import requests

response = requests.post(
    "https://giga-pdf.com/api/v1/billing/trial/start",
    headers={
        "Authorization": "Bearer YOUR_JWT_TOKEN",
        "Content-Type": "application/json"
    },
    json={"plan_id": "starter"}
)

data = response.json()["data"]
print(f"Trial ends: {data['trial_ends']}")
```

**JavaScript**
```javascript
// EN: Start a free trial for the Starter plan
// FR: Démarrer un essai gratuit pour le forfait Starter
const response = await fetch('https://giga-pdf.com/api/v1/billing/trial/start', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ plan_id: 'starter' })
});

const { data } = await response.json();
console.log(`Trial ends: ${data.trial_ends}`);
```

**PHP**
```php
<?php
// EN: Start a free trial for the Starter plan
// FR: Démarrer un essai gratuit pour le forfait Starter

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://giga-pdf.com/api/v1/billing/trial/start');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Authorization: Bearer YOUR_JWT_TOKEN',
    'Content-Type: application/json'
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['plan_id' => 'starter']));

$response = curl_exec($ch);
curl_close($ch);

$data = json_decode($response, true)['data'];
echo "Trial ends: " . $data['trial_ends'] . "\n";
?>
```

---

### Update Subscription / Mettre à jour l'abonnement

**EN**: Change the current subscription plan.

**FR**: Changer le forfait d'abonnement actuel.

```
PATCH /billing/subscription
```

#### Request Body / Corps de la requête

```json
{
  "plan_id": "pro"
}
```

#### Response during trial / Réponse pendant l'essai

```json
{
  "success": true,
  "data": {
    "status": "trialing",
    "current_plan": "pro",
    "plan_name": "Pro",
    "is_in_trial": true,
    "trial_days_remaining": 10,
    "message": "Plan changed to Pro. No charge during trial period."
  }
}
```

#### Examples / Exemples

**cURL**
```bash
# EN: Upgrade to Pro plan
# FR: Passer au forfait Pro
curl -X PATCH "https://giga-pdf.com/api/v1/billing/subscription" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"plan_id": "pro"}'
```

**Python**
```python
# EN: Upgrade to Pro plan
# FR: Passer au forfait Pro
import requests

response = requests.patch(
    "https://giga-pdf.com/api/v1/billing/subscription",
    headers={
        "Authorization": "Bearer YOUR_JWT_TOKEN",
        "Content-Type": "application/json"
    },
    json={"plan_id": "pro"}
)

data = response.json()["data"]
print(f"New plan: {data['current_plan']}")
```

**JavaScript**
```javascript
// EN: Upgrade to Pro plan
// FR: Passer au forfait Pro
const response = await fetch('https://giga-pdf.com/api/v1/billing/subscription', {
  method: 'PATCH',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ plan_id: 'pro' })
});

const { data } = await response.json();
console.log(`New plan: ${data.current_plan}`);
```

**PHP**
```php
<?php
// EN: Upgrade to Pro plan
// FR: Passer au forfait Pro

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://giga-pdf.com/api/v1/billing/subscription');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PATCH');
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Authorization: Bearer YOUR_JWT_TOKEN',
    'Content-Type: application/json'
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['plan_id' => 'pro']));

$response = curl_exec($ch);
curl_close($ch);

$data = json_decode($response, true)['data'];
echo "New plan: " . $data['current_plan'] . "\n";
?>
```

---

### Cancel Subscription / Annuler l'abonnement

**EN**: Cancel the current subscription.

**FR**: Annuler l'abonnement actuel.

```
POST /billing/subscription/cancel
```

#### Request Body / Corps de la requête

```json
{
  "immediately": false
}
```

| Field / Champ | Type | Default / Défaut | Description |
|--------------|------|------------------|-------------|
| `immediately` | boolean | false | If true, cancel immediately. If false, cancel at period end. / Si vrai, annuler immédiatement. Si faux, annuler à la fin de la période. |

#### Examples / Exemples

**cURL**
```bash
# EN: Cancel subscription at period end
# FR: Annuler l'abonnement à la fin de la période
curl -X POST "https://giga-pdf.com/api/v1/billing/subscription/cancel" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"immediately": false}'
```

**Python**
```python
# EN: Cancel subscription at period end
# FR: Annuler l'abonnement à la fin de la période
import requests

response = requests.post(
    "https://giga-pdf.com/api/v1/billing/subscription/cancel",
    headers={
        "Authorization": "Bearer YOUR_JWT_TOKEN",
        "Content-Type": "application/json"
    },
    json={"immediately": False}
)

data = response.json()["data"]
print(f"Status: {data['status']}")
```

**JavaScript**
```javascript
// EN: Cancel subscription at period end
// FR: Annuler l'abonnement à la fin de la période
const response = await fetch('https://giga-pdf.com/api/v1/billing/subscription/cancel', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ immediately: false })
});

const { data } = await response.json();
console.log(`Status: ${data.status}`);
```

**PHP**
```php
<?php
// EN: Cancel subscription at period end
// FR: Annuler l'abonnement à la fin de la période

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://giga-pdf.com/api/v1/billing/subscription/cancel');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Authorization: Bearer YOUR_JWT_TOKEN',
    'Content-Type: application/json'
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['immediately' => false]));

$response = curl_exec($ch);
curl_close($ch);

$data = json_decode($response, true)['data'];
echo "Status: " . $data['status'] . "\n";
?>
```

---

### Reactivate Subscription / Réactiver l'abonnement

**EN**: Reactivate a subscription that was scheduled for cancellation.

**FR**: Réactiver un abonnement qui était prévu pour annulation.

```
POST /billing/subscription/reactivate
```

#### Examples / Exemples

**cURL**
```bash
# EN: Reactivate subscription
# FR: Réactiver l'abonnement
curl -X POST "https://giga-pdf.com/api/v1/billing/subscription/reactivate" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Python**
```python
# EN: Reactivate subscription
# FR: Réactiver l'abonnement
import requests

response = requests.post(
    "https://giga-pdf.com/api/v1/billing/subscription/reactivate",
    headers={"Authorization": "Bearer YOUR_JWT_TOKEN"}
)

data = response.json()["data"]
print(f"Status: {data['status']}")
```

---

## Checkout & Portal / Checkout et Portail

### Create Checkout Session / Créer une session de paiement

**EN**: Create a Stripe Checkout session for subscription.

**FR**: Créer une session Stripe Checkout pour l'abonnement.

```
POST /billing/checkout
```

#### Request Body / Corps de la requête

```json
{
  "plan_id": "starter",
  "success_url": "https://giga-pdf.com/billing/success",
  "cancel_url": "https://giga-pdf.com/billing/cancel"
}
```

#### Response / Réponse

```json
{
  "success": true,
  "data": {
    "session_id": "cs_test_...",
    "url": "https://checkout.stripe.com/..."
  }
}
```

#### Examples / Exemples

**cURL**
```bash
# EN: Create checkout session for Starter plan
# FR: Créer une session de paiement pour le forfait Starter
curl -X POST "https://giga-pdf.com/api/v1/billing/checkout" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "plan_id": "starter",
    "success_url": "https://giga-pdf.com/billing/success",
    "cancel_url": "https://giga-pdf.com/billing/cancel"
  }'
```

**Python**
```python
# EN: Create checkout session for Starter plan
# FR: Créer une session de paiement pour le forfait Starter
import requests

response = requests.post(
    "https://giga-pdf.com/api/v1/billing/checkout",
    headers={
        "Authorization": "Bearer YOUR_JWT_TOKEN",
        "Content-Type": "application/json"
    },
    json={
        "plan_id": "starter",
        "success_url": "https://giga-pdf.com/billing/success",
        "cancel_url": "https://giga-pdf.com/billing/cancel"
    }
)

data = response.json()["data"]
# Redirect user to Stripe Checkout
# Rediriger l'utilisateur vers Stripe Checkout
print(f"Redirect to: {data['url']}")
```

**JavaScript**
```javascript
// EN: Create checkout session for Starter plan
// FR: Créer une session de paiement pour le forfait Starter
const response = await fetch('https://giga-pdf.com/api/v1/billing/checkout', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    plan_id: 'starter',
    success_url: 'https://giga-pdf.com/billing/success',
    cancel_url: 'https://giga-pdf.com/billing/cancel'
  })
});

const { data } = await response.json();
// Redirect user to Stripe Checkout
// Rediriger l'utilisateur vers Stripe Checkout
window.location.href = data.url;
```

**PHP**
```php
<?php
// EN: Create checkout session for Starter plan
// FR: Créer une session de paiement pour le forfait Starter

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://giga-pdf.com/api/v1/billing/checkout');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Authorization: Bearer YOUR_JWT_TOKEN',
    'Content-Type: application/json'
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
    'plan_id' => 'starter',
    'success_url' => 'https://giga-pdf.com/billing/success',
    'cancel_url' => 'https://giga-pdf.com/billing/cancel'
]));

$response = curl_exec($ch);
curl_close($ch);

$data = json_decode($response, true)['data'];
// Redirect user to Stripe Checkout
// Rediriger l'utilisateur vers Stripe Checkout
header('Location: ' . $data['url']);
exit;
?>
```

---

### Create Portal Session / Créer une session portail

**EN**: Create a Stripe Customer Portal session to manage subscription and payment methods.

**FR**: Créer une session de portail client Stripe pour gérer l'abonnement et les moyens de paiement.

```
POST /billing/portal
```

#### Request Body / Corps de la requête

```json
{
  "return_url": "https://giga-pdf.com/settings/billing"
}
```

#### Examples / Exemples

**cURL**
```bash
# EN: Create portal session
# FR: Créer une session portail
curl -X POST "https://giga-pdf.com/api/v1/billing/portal" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"return_url": "https://giga-pdf.com/settings/billing"}'
```

---

## Plans / Forfaits

### List Available Plans / Lister les forfaits disponibles

**EN**: Get list of available subscription plans.

**FR**: Obtenir la liste des forfaits d'abonnement disponibles.

```
GET /billing/plans
```

#### Response / Réponse

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "slug": "free",
      "name": "Free",
      "description": "Get started with basic PDF tools",
      "price": 0,
      "currency": "eur",
      "interval": "month",
      "storage_gb": 1,
      "api_calls_limit": 100,
      "document_limit": 10,
      "features": ["Basic PDF editing", "5 pages per document"],
      "is_popular": false,
      "trial_days": null
    },
    {
      "id": "uuid",
      "slug": "starter",
      "name": "Starter",
      "description": "For individuals and small teams",
      "price": 9.0,
      "currency": "eur",
      "interval": "month",
      "storage_gb": 10,
      "api_calls_limit": 1000,
      "document_limit": 100,
      "features": ["All Free features", "OCR support", "Priority support"],
      "is_popular": true,
      "trial_days": 14
    },
    {
      "id": "uuid",
      "slug": "pro",
      "name": "Pro",
      "description": "For professionals and growing teams",
      "price": 29.0,
      "currency": "eur",
      "interval": "month",
      "storage_gb": 100,
      "api_calls_limit": 10000,
      "document_limit": 1000,
      "features": ["All Starter features", "API access", "Batch processing"],
      "is_popular": false,
      "trial_days": 14
    }
  ]
}
```

#### Examples / Exemples

**cURL**
```bash
# EN: List all available plans
# FR: Lister tous les forfaits disponibles
curl -X GET "https://giga-pdf.com/api/v1/billing/plans"
```

**Python**
```python
# EN: List all available plans
# FR: Lister tous les forfaits disponibles
import requests

response = requests.get("https://giga-pdf.com/api/v1/billing/plans")
plans = response.json()["data"]

for plan in plans:
    print(f"{plan['name']}: €{plan['price']}/month")
    print(f"  Storage: {plan['storage_gb']} GB")
    print(f"  API calls: {plan['api_calls_limit']}")
```

**JavaScript**
```javascript
// EN: List all available plans
// FR: Lister tous les forfaits disponibles
const response = await fetch('https://giga-pdf.com/api/v1/billing/plans');
const { data: plans } = await response.json();

plans.forEach(plan => {
  console.log(`${plan.name}: €${plan.price}/month`);
  console.log(`  Storage: ${plan.storage_gb} GB`);
  console.log(`  API calls: ${plan.api_calls_limit}`);
});
```

**PHP**
```php
<?php
// EN: List all available plans
// FR: Lister tous les forfaits disponibles

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://giga-pdf.com/api/v1/billing/plans');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = curl_exec($ch);
curl_close($ch);

$plans = json_decode($response, true)['data'];

foreach ($plans as $plan) {
    echo $plan['name'] . ": €" . $plan['price'] . "/month\n";
    echo "  Storage: " . $plan['storage_gb'] . " GB\n";
    echo "  API calls: " . $plan['api_calls_limit'] . "\n";
}
?>
```

---

## Invoices / Factures

### List Invoices / Lister les factures

**EN**: Get list of invoices.

**FR**: Obtenir la liste des factures.

```
GET /billing/invoices?limit=10
```

#### Query Parameters / Paramètres de requête

| Parameter / Paramètre | Type | Default / Défaut | Description |
|----------------------|------|------------------|-------------|
| `limit` | integer | 10 | Number of invoices to return (1-100) / Nombre de factures à retourner (1-100) |

#### Response / Réponse

```json
{
  "success": true,
  "data": [
    {
      "id": "in_1234567890",
      "number": "INV-0001",
      "status": "paid",
      "amount_due": 900,
      "amount_paid": 900,
      "currency": "eur",
      "created": "2025-01-15T10:30:00Z",
      "due_date": "2025-01-30T10:30:00Z",
      "pdf_url": "https://pay.stripe.com/invoice/...",
      "hosted_invoice_url": "https://invoice.stripe.com/..."
    }
  ]
}
```

#### Examples / Exemples

**cURL**
```bash
# EN: List invoices
# FR: Lister les factures
curl -X GET "https://giga-pdf.com/api/v1/billing/invoices?limit=10" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Python**
```python
# EN: List invoices
# FR: Lister les factures
import requests

response = requests.get(
    "https://giga-pdf.com/api/v1/billing/invoices",
    headers={"Authorization": "Bearer YOUR_JWT_TOKEN"},
    params={"limit": 10}
)

invoices = response.json()["data"]
for invoice in invoices:
    print(f"Invoice {invoice['number']}: €{invoice['amount_paid']/100} ({invoice['status']})")
```

---

### Get Invoice / Obtenir une facture

```
GET /billing/invoices/{invoice_id}
```

### Download Invoice PDF / Télécharger le PDF de la facture

```
GET /billing/invoices/{invoice_id}/download
```

---

## Payment Methods / Moyens de paiement

### List Payment Methods / Lister les moyens de paiement

**EN**: List all payment methods.

**FR**: Lister tous les moyens de paiement.

```
GET /billing/payment-methods
```

#### Response / Réponse

```json
{
  "success": true,
  "data": [
    {
      "id": "pm_1234567890",
      "type": "card",
      "card": {
        "brand": "visa",
        "last4": "4242",
        "exp_month": 12,
        "exp_year": 2025
      },
      "is_default": true,
      "created_at": "2025-01-15T10:30:00Z"
    }
  ]
}
```

#### Examples / Exemples

**cURL**
```bash
# EN: List payment methods
# FR: Lister les moyens de paiement
curl -X GET "https://giga-pdf.com/api/v1/billing/payment-methods" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Python**
```python
# EN: List payment methods
# FR: Lister les moyens de paiement
import requests

response = requests.get(
    "https://giga-pdf.com/api/v1/billing/payment-methods",
    headers={"Authorization": "Bearer YOUR_JWT_TOKEN"}
)

payment_methods = response.json()["data"]
for pm in payment_methods:
    if pm['card']:
        print(f"{pm['card']['brand'].upper()} **** {pm['card']['last4']}")
        print(f"  Expires: {pm['card']['exp_month']}/{pm['card']['exp_year']}")
        print(f"  Default: {pm['is_default']}")
```

---

### Add Payment Method / Ajouter un moyen de paiement

**EN**: Add a new payment method. The `payment_method_id` should be obtained from Stripe.js on the frontend.

**FR**: Ajouter un nouveau moyen de paiement. Le `payment_method_id` doit être obtenu depuis Stripe.js côté frontend.

```
POST /billing/payment-methods
```

#### Request Body / Corps de la requête

```json
{
  "payment_method_id": "pm_1234567890"
}
```

---

### Remove Payment Method / Supprimer un moyen de paiement

```
DELETE /billing/payment-methods/{payment_method_id}
```

---

### Set Default Payment Method / Définir le moyen de paiement par défaut

```
POST /billing/payment-methods/{payment_method_id}/default
```

---

## Usage / Utilisation

### Get Usage Summary / Obtenir le résumé d'utilisation

**EN**: Get current usage and limits for the billing period.

**FR**: Obtenir l'utilisation actuelle et les limites pour la période de facturation.

```
GET /billing/usage
```

#### Response / Réponse

```json
{
  "success": true,
  "data": {
    "current_period_start": "2025-01-01T00:00:00Z",
    "current_period_end": "2025-02-01T00:00:00Z",
    "usage": {
      "documents": 45,
      "storage_gb": 2.5,
      "api_calls": 523
    },
    "limits": {
      "documents": 100,
      "storage_gb": 10,
      "api_calls": 1000
    },
    "billing_entity_type": "user",
    "is_in_trial": false
  }
}
```

#### Examples / Exemples

**cURL**
```bash
# EN: Get usage summary
# FR: Obtenir le résumé d'utilisation
curl -X GET "https://giga-pdf.com/api/v1/billing/usage" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Python**
```python
# EN: Get usage summary
# FR: Obtenir le résumé d'utilisation
import requests

response = requests.get(
    "https://giga-pdf.com/api/v1/billing/usage",
    headers={"Authorization": "Bearer YOUR_JWT_TOKEN"}
)

data = response.json()["data"]
usage = data["usage"]
limits = data["limits"]

print(f"Documents: {usage['documents']}/{limits['documents']}")
print(f"Storage: {usage['storage_gb']:.2f}/{limits['storage_gb']} GB")
print(f"API Calls: {usage['api_calls']}/{limits['api_calls']}")
```

**JavaScript**
```javascript
// EN: Get usage summary
// FR: Obtenir le résumé d'utilisation
const response = await fetch('https://giga-pdf.com/api/v1/billing/usage', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN'
  }
});

const { data } = await response.json();
const { usage, limits } = data;

console.log(`Documents: ${usage.documents}/${limits.documents}`);
console.log(`Storage: ${usage.storage_gb.toFixed(2)}/${limits.storage_gb} GB`);
console.log(`API Calls: ${usage.api_calls}/${limits.api_calls}`);
```

**PHP**
```php
<?php
// EN: Get usage summary
// FR: Obtenir le résumé d'utilisation

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://giga-pdf.com/api/v1/billing/usage');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Authorization: Bearer YOUR_JWT_TOKEN'
]);

$response = curl_exec($ch);
curl_close($ch);

$data = json_decode($response, true)['data'];
$usage = $data['usage'];
$limits = $data['limits'];

echo "Documents: " . $usage['documents'] . "/" . $limits['documents'] . "\n";
echo "Storage: " . number_format($usage['storage_gb'], 2) . "/" . $limits['storage_gb'] . " GB\n";
echo "API Calls: " . $usage['api_calls'] . "/" . $limits['api_calls'] . "\n";
?>
```

---

## Webhooks

**EN**: GigaPDF uses Stripe webhooks to handle payment events. Configure your webhook endpoint in the Stripe Dashboard.

**FR**: GigaPDF utilise les webhooks Stripe pour gérer les événements de paiement. Configurez votre endpoint webhook dans le Dashboard Stripe.

### Webhook URL / URL du webhook

```
https://giga-pdf.com/webhooks/stripe
```

### Events Handled / Événements gérés

| Event / Événement | Description |
|-------------------|-------------|
| `checkout.session.completed` | Payment successful / Paiement réussi |
| `customer.subscription.created` | New subscription activated / Nouvel abonnement activé |
| `customer.subscription.updated` | Subscription modified / Abonnement modifié |
| `customer.subscription.deleted` | Subscription canceled / Abonnement annulé |
| `customer.subscription.trial_will_end` | Trial ending soon (3 days) / Essai se terminant bientôt (3 jours) |
| `invoice.paid` | Successful payment / Paiement réussi |
| `invoice.payment_failed` | Failed payment / Échec de paiement |

### Webhook Configuration / Configuration du webhook

**EN**: In your Stripe Dashboard:
1. Go to Developers > Webhooks
2. Add endpoint: `https://giga-pdf.com/webhooks/stripe`
3. Select the events listed above
4. Copy the webhook signing secret to your `.env` file as `STRIPE_WEBHOOK_SECRET`

**FR**: Dans votre Dashboard Stripe :
1. Allez dans Développeurs > Webhooks
2. Ajoutez l'endpoint : `https://giga-pdf.com/webhooks/stripe`
3. Sélectionnez les événements listés ci-dessus
4. Copiez le secret de signature webhook dans votre fichier `.env` comme `STRIPE_WEBHOOK_SECRET`

---

## Background Tasks / Tâches en arrière-plan

**EN**: GigaPDF uses Celery for background billing tasks.

**FR**: GigaPDF utilise Celery pour les tâches de facturation en arrière-plan.

### Running the Billing Worker / Lancer le worker billing

```bash
celery -A app.tasks.celery_app worker -Q billing --loglevel=info
```

### Running Celery Beat (Scheduler) / Lancer Celery Beat (Planificateur)

```bash
celery -A app.tasks.celery_app beat --loglevel=info
```

### Scheduled Tasks / Tâches planifiées

| Task / Tâche | Schedule / Planification | Description |
|--------------|-------------------------|-------------|
| `sync_plans_to_stripe` | Every hour / Toutes les heures | Sync plans from database to Stripe / Synchroniser les forfaits de la base de données vers Stripe |
| `process_overdue_payments` | Every 24 hours / Toutes les 24 heures | Process overdue payments, suspend accounts / Traiter les impayés, suspendre les comptes |
| `process_expired_trials` | Every hour / Toutes les heures | End expired trials, downgrade plans / Terminer les essais expirés, rétrograder les forfaits |
| `send_trial_reminders` | Every 24 hours / Toutes les 24 heures | Send trial expiration reminders / Envoyer des rappels d'expiration d'essai |
| `cleanup_stale_subscriptions` | Every 24 hours / Toutes les 24 heures | Sync subscription status with Stripe / Synchroniser le statut des abonnements avec Stripe |

### Plan Synchronization / Synchronisation des forfaits

**EN**: Plans are managed in the database and automatically synced to Stripe:
- Products and prices are created/updated automatically
- Price changes create new Stripe prices (old ones are archived)
- No need to manually create products in Stripe Dashboard

**FR**: Les forfaits sont gérés dans la base de données et synchronisés automatiquement vers Stripe :
- Les produits et prix sont créés/mis à jour automatiquement
- Les changements de prix créent de nouveaux prix Stripe (les anciens sont archivés)
- Pas besoin de créer manuellement les produits dans le Dashboard Stripe

### Manual Sync / Synchronisation manuelle

```bash
# Trigger immediate sync / Déclencher une synchronisation immédiate
celery -A app.tasks.celery_app call billing.sync_plans_to_stripe
```

---

## Public Endpoints (Landing Page) / Endpoints publics (Landing Page)

**EN**: These endpoints are available for landing page integration without authentication.

**FR**: Ces endpoints sont disponibles pour l'intégration de la landing page sans authentification.

### Base URL / URL de base
```
https://giga-pdf.com/api/v1/public/billing
```

### List Plans (Public) / Lister les forfaits (Public)

```
GET /public/billing/plans
```

**EN**: Get all available plans without authentication.

**FR**: Obtenir tous les forfaits disponibles sans authentification.

#### Examples / Exemples

**cURL**
```bash
# EN: List all plans from landing page
# FR: Lister tous les forfaits depuis la landing page
curl -X GET "https://giga-pdf.com/api/v1/public/billing/plans"
```

**JavaScript**
```javascript
// EN: Fetch plans for pricing page
// FR: Récupérer les forfaits pour la page tarifs
async function fetchPlans() {
  const response = await fetch('https://giga-pdf.com/api/v1/public/billing/plans');
  const { data: plans } = await response.json();

  plans.forEach(plan => {
    console.log(`${plan.name}: €${plan.price}/${plan.interval}`);
    console.log(`  Trial: ${plan.trial_days} days`);
  });

  return plans;
}
```

---

### Create Checkout (Public) / Créer un checkout (Public)

```
POST /public/billing/checkout
```

**EN**: Create a Stripe checkout session. Works for:
- **Authenticated users**: Linked to their account
- **Guest users**: Requires email, creates guest checkout

**FR**: Créer une session de checkout Stripe. Fonctionne pour :
- **Utilisateurs authentifiés**: Lié à leur compte
- **Utilisateurs invités**: Nécessite un email, crée un checkout invité

#### Request Body / Corps de la requête

```json
{
  "plan_id": "starter",
  "email": "newuser@example.com",
  "success_url": "https://giga-pdf.com/welcome?session_id={CHECKOUT_SESSION_ID}",
  "cancel_url": "https://giga-pdf.com/pricing"
}
```

| Field / Champ | Type | Required / Requis | Description |
|--------------|------|-------------------|-------------|
| `plan_id` | string | Yes / Oui | Plan slug: "starter" or "pro" / Slug du forfait |
| `email` | string | Guest only / Invités uniquement | Required for guest checkout / Requis pour checkout invité |
| `success_url` | string | Yes / Oui | Redirect URL on success / URL de redirection en cas de succès |
| `cancel_url` | string | Yes / Oui | Redirect URL on cancel / URL de redirection en cas d'annulation |

#### Examples / Exemples

**cURL (Guest checkout)**
```bash
# EN: Create checkout for new user (guest)
# FR: Créer un checkout pour nouvel utilisateur (invité)
curl -X POST "https://giga-pdf.com/api/v1/public/billing/checkout" \
  -H "Content-Type: application/json" \
  -d '{
    "plan_id": "starter",
    "email": "newuser@example.com",
    "success_url": "https://giga-pdf.com/welcome?session_id={CHECKOUT_SESSION_ID}",
    "cancel_url": "https://giga-pdf.com/pricing"
  }'
```

**JavaScript (Landing page)**
```javascript
// EN: Subscribe from landing page
// FR: S'abonner depuis la landing page
async function subscribeToPlan(planSlug, email, authToken = null) {
  const headers = {
    'Content-Type': 'application/json'
  };

  // Add auth token if user is logged in
  // Ajouter le token auth si l'utilisateur est connecté
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const body = {
    plan_id: planSlug,
    success_url: `${window.location.origin}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${window.location.origin}/pricing`
  };

  // Email required for guests / Email requis pour les invités
  if (!authToken && email) {
    body.email = email;
  }

  const response = await fetch('https://giga-pdf.com/api/v1/public/billing/checkout', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const { data } = await response.json();

  // Redirect to Stripe / Rediriger vers Stripe
  window.location.href = data.url;
}
```

**PHP**
```php
<?php
// EN: Create checkout session from backend
// FR: Créer une session checkout depuis le backend

$data = [
    'plan_id' => 'starter',
    'email' => $_POST['email'],
    'success_url' => 'https://giga-pdf.com/welcome?session_id={CHECKOUT_SESSION_ID}',
    'cancel_url' => 'https://giga-pdf.com/pricing'
];

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://giga-pdf.com/api/v1/public/billing/checkout');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);

if ($result['success']) {
    // Redirect to Stripe Checkout / Rediriger vers Stripe Checkout
    header('Location: ' . $result['data']['url']);
    exit;
} else {
    // Handle error / Gérer l'erreur
    echo "Error: " . $result['error'];
}
?>
```

---

### Start Trial (Public) / Démarrer l'essai (Public)

```
POST /public/billing/trial/start?plan_id=starter
```

**EN**: Start a 14-day free trial. **Requires authentication.**

**FR**: Démarrer un essai gratuit de 14 jours. **Nécessite une authentification.**

#### Examples / Exemples

**cURL**
```bash
# EN: Start free trial
# FR: Démarrer l'essai gratuit
curl -X POST "https://giga-pdf.com/api/v1/public/billing/trial/start?plan_id=starter" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### Check Trial Eligibility / Vérifier l'éligibilité à l'essai

```
GET /public/billing/check-trial-eligibility
```

**EN**: Check if user can start a trial. **Requires authentication.**

**FR**: Vérifier si l'utilisateur peut démarrer un essai. **Nécessite une authentification.**

#### Response / Réponse

```json
{
  "success": true,
  "data": {
    "eligible": true,
    "reason": null,
    "message": "You can start a 14-day free trial!",
    "current_plan": "free",
    "trial_days_available": 14
  }
}
```

---

## Error Codes / Codes d'erreur

| Code | Description EN | Description FR |
|------|---------------|----------------|
| 400 | Bad request / Invalid data | Requête invalide / Données invalides |
| 401 | Unauthorized - Invalid or missing token | Non autorisé - Token invalide ou manquant |
| 403 | Forbidden - Permission denied | Interdit - Permission refusée |
| 404 | Resource not found | Ressource non trouvée |
| 429 | Too many requests | Trop de requêtes |
| 500 | Internal server error | Erreur serveur interne |

### Common Error Messages / Messages d'erreur courants

| Message EN | Message FR | Solution |
|------------|------------|----------|
| "Only the organization owner can manage billing" | "Seul le propriétaire de l'organisation peut gérer la facturation" | Contact the organization owner / Contactez le propriétaire de l'organisation |
| "Trial period already used" | "Période d'essai déjà utilisée" | Subscribe to continue / Abonnez-vous pour continuer |
| "No active subscription to update" | "Pas d'abonnement actif à mettre à jour" | Create a subscription first / Créez d'abord un abonnement |
| "Plan not found" | "Forfait non trouvé" | Check available plans / Vérifiez les forfaits disponibles |

---

## Organization Billing / Facturation d'organisation

**EN**: For users who are members of an organization (tenant):

- **Shared quotas**: All members share the organization's storage, API calls, and document limits
- **Owner-only management**: Only the organization owner can:
  - Change subscription plans
  - Add/remove payment methods
  - Cancel or reactivate subscriptions
  - Access billing portal
- **Billing information**: Members with `VIEW_BILLING` permission can view:
  - Current subscription status
  - Usage statistics
  - Invoices

**FR**: Pour les utilisateurs membres d'une organisation (tenant) :

- **Quotas partagés**: Tous les membres partagent le stockage, les appels API et les limites de documents de l'organisation
- **Gestion réservée au propriétaire**: Seul le propriétaire de l'organisation peut :
  - Changer de forfait d'abonnement
  - Ajouter/supprimer des moyens de paiement
  - Annuler ou réactiver les abonnements
  - Accéder au portail de facturation
- **Informations de facturation**: Les membres avec la permission `VIEW_BILLING` peuvent voir :
  - Le statut de l'abonnement actuel
  - Les statistiques d'utilisation
  - Les factures
