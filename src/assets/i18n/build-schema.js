const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/dorel/workspace/velto-store/src/assets/i18n';

// ============================================================================
// Canonical i18n schema. Single source of truth.
// Every key referenced from src/app MUST appear here. Nothing else.
// ============================================================================

const SCHEMA = {
  app: {
    name: null
  },
  currentImage: {
    url: null
  },
  auth: {
    loginSubtitle: null,
    loginWithGoogle: null,
    loading: null
  },
  menu: {
    dashboard: null,
    calendar: null,
    reservations: null,
    vehicles: null,
    clients: null,
    payments: null,
    expenses: null,
    contracts: null,
    inspections: null,
    reports: null,
    settings: null
  },
  layout: {
    footer: null,
    userRoleAdmin: null,
    userRoleEmployee: null
  },
  common: {
    loading: null,
    save: null,
    cancel: null,
    edit: null,
    delete: null,
    search: null,
    back: null,
    moduleInProgress: null,
    all: null,
    or: null,
    create: null,
    viewAll: null,
    copied: null
  },
  vehicles: {
    title: null,
    subtitle: null,
    new: null,
    edit: null,
    searchPlaceholder: null,
    noVehicles: null,
    addFirst: null,
    viewDetail: null,
    filterAllStatus: null,
    filterAllCategories: null,
    noPhotos: null,
    changeStatusTitle: null,
    deleteTitle: null,
    deleteConfirm: null,
    fields: {
      brand: null,
      model: null,
      version: null,
      year: null,
      plateNumber: null,
      category: null,
      bodyType: null,
      acrissCode: null,
      fuelType: null,
      transmission: null,
      seats: null,
      luggageCapacity: null,
      currentKm: null,
      color: null,
      vin: null,
      description: null,
      publicEnabled: null
    },
    bodyTypes: {
      '2_4_doors': null,
      '4_5_doors': null,
      estate: null,
      suv: null,
      van: null,
      cabrio: null,
      mpv: null
    },
    sections: {
      basicInfo: null,
      rentalClassification: null,
      features: null,
      pricing: null,
      reservations: null
    },
    tabs: {
      photos: null,
      pricing: null
    },
    features: {
      airConditioning: null,
      navigation: null,
      parkingSensors: null,
      rearCamera: null,
      cruiseControl: null
    },
    actions: {
      changeStatus: null
    },
    help: {
      acrissGenerated: null
    },
    photos: {
      openGallery: null,
      closeGallery: null,
      previous: null,
      next: null,
      count: null,
      imageAlt: null,
      thumbnail: null
    },
    pricing: {
      conditions: null,
      rules: null,
      defaultDepositAmount: null,
      includedKmPerDay: null,
      extraKmPrice: null,
      minimumRentalDays: null,
      manualPriceAllowed: null,
      minDays: null,
      maxDays: null,
      pricePerDay: null,
      addRule: null,
      removeRule: null,
      restoreDefaults: null,
      days: null,
      day: null,
      priceFrom: null,
      deposit: null,
      allowed: null,
      notAllowed: null
    },
    reservations: {
      noReservations: null,
      upcoming: null,
      inProgress: null,
      history: null
    }
  },
  clients: {
    title: null,
    subtitle: null,
    new: null,
    edit: null,
    searchPlaceholder: null,
    noClients: null,
    sections: {
      personalData: null,
      drivingLicense: null,
      internalManagement: null,
      documents: null,
      reservations: null
    },
    fields: {
      fullName: null,
      phone: null,
      email: null,
      documentType: null,
      documentNumber: null,
      address: null,
      birthDate: null,
      drivingLicenseNumber: null,
      drivingLicenseIssueDate: null,
      drivingLicenseExpiryDate: null,
      drivingLicenseCountry: null,
      trustLevel: null,
      notes: null
    },
    documentTypes: {
      dni: null,
      nie: null,
      passport: null,
      other: null
    },
    trustLevel: {
      new: null,
      known: null,
      regular: null,
      risk: null,
      blocked: null
    },
    documents: {
      documentFront: null,
      documentBack: null,
      drivingLicenseFront: null,
      drivingLicenseBack: null,
      other: null,
      delete: null,
      open: null,
      noDocuments: null,
      invalidType: null,
      maxSizeExceeded: null
    },
    reservations: {
      noReservations: null,
      upcoming: null,
      history: null
    },
    payments: {
      totalPaid: null,
      totalPending: null,
      rentalPaid: null,
      depositsCollected: null,
      depositsRetained: null,
      depositsReturned: null,
      extrasPaid: null,
      reservationsWithDebt: null,
      reservationsWithDebtHint: null,
      empty: null,
      rental: null,
      deposits: null,
      extras: null
    }
  },
  reservations: {
    title: null,
    subtitle: null,
    new: null,
    detail: null,
    steps: {
      dates: null,
      vehicle: null,
      client: null,
      summary: null
    },
    fields: {
      pickupDate: null,
      pickupTime: null,
      returnDate: null,
      returnTime: null,
      pickupLocation: null,
      returnLocation: null,
      totalDays: null,
      notes: null
    },
    availability: {
      search: null,
      noVehiclesAvailable: null,
      selectVehicle: null
    },
    pricing: {
      pricePerDay: null,
      basePrice: null,
      finalPrice: null,
      initialPayment: null,
      remainingPayment: null,
      deposit: null,
      manualAdjustment: null
    },
    client: {
      select: null,
      search: null,
      createQuick: null,
      fullName: null,
      phone: null,
      email: null,
      documentNumber: null
    },
    status: {
      reserved: null,
      confirmed: null,
      delivered: null,
      returned: null,
      closed: null,
      cancelled: null
    },
    paymentStatus: {
      pending: null
    },
    actions: {
      cancel: null,
      createReservation: null,
      viewReservation: null,
      close: null
    },
    messages: {
      invalidDates: null
    },
    list: {
      empty: null
    }
  },
  payments: {
    title: null,
    subtitle: null,
    registerPayment: null,
    fields: {
      concept: null,
      amount: null,
      paidAmount: null,
      pendingAmount: null,
      method: null,
      type: null,
      source: null,
      dueDate: null,
      paidAt: null,
      notes: null,
      internalReference: null,
      externalReference: null
    },
    methods: {
      cash: null,
      bankTransfer: null,
      bizum: null,
      physicalPos: null,
      redsys: null,
      manualCard: null,
      other: null
    },
    types: {
      initialPayment: null,
      remainingPayment: null,
      rentalPayment: null,
      deposit: null,
      depositRefund: null,
      depositRetention: null,
      extraFuel: null,
      refuelPenalty: null,
      extraCleaning: null,
      extraKm: null,
      extraDamage: null,
      extraFine: null,
      extraOther: null,
      freePayment: null
    },
    status: {
      pending: null,
      paid: null,
      partial: null,
      failed: null,
      cancelled: null,
      refunded: null
    },
    actions: {
      markAsPaid: null,
      cancelPayment: null,
      viewReservation: null
    },
    list: {
      empty: null
    },
    summary: {
      title: null,
      totalPaid: null,
      rentalTotal: null,
      extraChargesTotal: null
    },
    deposit: {
      refundFull: null,
      retain: null
    },
    redsys: {
      title: null,
      order: null,
      authorizationCode: null,
      responseCode: null,
      notificationReceived: null
    },
    free: {
      title: null,
      subtitle: null,
      new: null,
      amount: null,
      concept: null,
      conceptPlaceholder: null,
      payerSection: null,
      payerHint: null,
      payerName: null,
      payerEmail: null,
      payerPhone: null,
      generateRedsysLink: null,
      openRedsys: null,
      copyLink: null,
      created: null,
      paid: null,
      failed: null,
      amountRequired: null,
      conceptRequired: null,
      webhookHint: null,
      manualHint: null
    },
    filters: {
      reservationPayments: null,
      freePayments: null
    }
  },
  inspections: {
    title: null,
    subtitle: null,
    startPickup: null,
    startReturn: null,
    completePickup: null,
    completeReturn: null,
    closeReservation: null,
    pickup: null,
    return: null,
    type: {
      pickup: null,
      return: null
    },
    status: {
      draft: null,
      completed: null,
      cancelled: null
    },
    fuel: {
      empty: null,
      quarter: null,
      half: null,
      threeQuarters: null,
      full: null
    },
    cleanliness: {
      dirty: null,
      normal: null,
      clean: null,
      veryDirty: null
    },
    photos: {
      front: null,
      rear: null,
      leftSide: null,
      rightSide: null,
      interior: null,
      dashboard: null,
      fuel: null,
      damage: null,
      other: null,
      noPhotos: null
    },
    fields: {
      km: null,
      fuelLevel: null,
      cleanliness: null,
      notes: null
    },
    sections: {
      deliveryAndReturn: null,
      reservationSummary: null,
      checklist: null,
      vehicleStatus: null,
      photos: null,
      damages: null,
      extraCharges: null,
      deposit: null
    },
    checklist: {
      clientIdentityChecked: null,
      drivingLicenseChecked: null,
      contractChecked: null,
      paymentChecked: null,
      depositChecked: null,
      keysDelivered: null,
      keysReturned: null,
      vehicleDocumentsDelivered: null,
      accessoriesChecked: null
    },
    damages: {
      add: null,
      area: null,
      areaFront: null,
      areaRear: null,
      areaLeftSide: null,
      areaRightSide: null,
      areaRoof: null,
      areaInterior: null,
      areaWheels: null,
      areaWindows: null,
      areaOther: null,
      severity: null,
      minor: null,
      medium: null,
      serious: null,
      description: null
    },
    extraCharges: {
      extraKm: null,
      fuel: null,
      refuelPenalty: null,
      cleaning: null,
      damage: null,
      fine: null,
      other: null,
      total: null
    },
    actions: {
      view: null,
      startPickup: null,
      startReturn: null
    },
    messages: {
      noPickup: null,
      noReturn: null
    }
  },
  contracts: {
    title: null,
    subtitle: null,
    status: {
      draft: null,
      generated: null,
      pendingSignature: null,
      signed: null,
      cancelled: null,
      expired: null
    },
    actions: {
      title: null,
      generate: null,
      generateSigningLink: null,
      copySigningLink: null,
      cancelLink: null,
      sendEmail: null,
      downloadPdf: null,
      downloadSignedPdf: null,
      viewOriginalPdf: null,
      viewContract: null
    },
    messages: {
      linkCopied: null
    },
    sign: {
      title: null,
      subtitle: null,
      readOnlyNotice: null,
      acceptConditions: null,
      submitSignature: null,
      successTitle: null,
      successMessage: null,
      alreadySigned: null,
      expired: null,
      invalid: null,
      highlightsTitle: null
    },
    fields: {
      client: null,
      vehicle: null,
      reservation: null,
      generatedAt: null,
      signedAt: null,
      emailedAt: null,
      depositAmount: null,
      allStatuses: null
    },
    email: {
      title: null,
      recipient: null,
      send: null
    },
    signingLink: {
      title: null
    },
    list: {
      empty: null
    }
  },
  workflow: {
    nextAction: null,
    blockedAction: null,
    cannotDeliver: null,
    cannotReturn: null,
    cannotClose: null,
    cannotCancel: null,
    missingContract: null,
    missingSignature: null,
    missingInitialPayment: null,
    missingRemainingPayment: null,
    missingDeposit: null,
    missingPickupInspection: null,
    missingReturnInspection: null,
    unsettledDeposit: null,
    missingReservation: null,
    cancelled: null,
    contractAlreadySigned: null,
    contractCancelled: null,
    pickupAlreadyCompleted: null,
    returnAlreadyCompleted: null,
    payInitial: null,
    generateContract: null,
    generateSigningLink: null,
    contractPending: null,
    payRemaining: null,
    payDeposit: null,
    startPickup: null,
    startReturn: null,
    settleDeposit: null,
    closeReservation: null,
    blockedPickup: null,
    blockedReturn: null,
    blockedSettleDeposit: null,
    blockedClose: null
  },
  dashboard: {
    title: null,
    subtitle: null,
    allClearTitle: null,
    allClearHint: null,
    viewAll: null,
    viewReservation: null,
    viewContract: null,
    viewVehicle: null,
    fleet: {
      label: null,
      available: null,
      rented: null,
      total: null
    },
    pendingPayment: {
      label: null,
      hint: null
    },
    pendingSignature: {
      label: null,
      hint: null
    },
    pickupToday: {
      label: null,
      at: null
    },
    returnToday: {
      label: null,
      at: null
    },
    returnOpen: {
      label: null,
      hint: null
    },
    vehicleRented: {
      label: null
    }
  },
  photos: {
    takePhoto: null,
    uploadFromGallery: null,
    camera: null,
    gallery: null
  },
  brand: {
    logoAlt: null,
    velto: null
  },
  maintenance: {
    title: null,
    subtitle: null,
    new: null,
    edit: null,
    history: null,
    upcoming: null,
    overdue: null,
    completed: null,
    dueSoon: null,
    empty: null,
    itemSingular: null,
    itemPlural: null,
    type: {
      oilChange: null,
      tires: null,
      itv: null,
      insurance: null,
      generalRevision: null,
      brakes: null,
      battery: null,
      breakdown: null,
      cleaning: null,
      other: null
    },
    status: {
      pending: null,
      scheduled: null,
      completed: null,
      overdue: null,
      cancelled: null
    },
    priority: {
      low: null,
      medium: null,
      high: null,
      critical: null
    },
    fields: {
      title: null,
      status: null,
      priority: null,
      description: null,
      performedAt: null,
      performedAtDate: null,
      performedAtKm: null,
      nextDue: null,
      nextDueDate: null,
      nextDueKm: null,
      cost: null,
      provider: null,
      notes: null,
      invoice: null
    },
    actions: {
      complete: null,
      cancel: null,
      uploadInvoice: null
    },
    alerts: {
      dueSoon: null,
      overdue: null,
      kmSoon: null,
      kmOverdue: null
    }
  },
  timeline: {
    title: null,
    reservationCreated: null,
    initialPaymentPaid: null,
    contractGenerated: null,
    contractSigned: null,
    remainingPaymentPaid: null,
    depositPaid: null,
    pickupCompleted: null,
    returnCompleted: null,
    depositSettled: null,
    reservationClosed: null,
    completed: null,
    current: null,
    pending: null,
    blocked: null,
    skippedByException: null,
    nextAction: null
  }
};

// ============================================================================
// Validation
// ============================================================================

const usedRaw = fs.readFileSync(path.join(ROOT, 'used-i18n-keys.txt'), 'utf8');
const used = new Set(usedRaw.split('\n').filter(Boolean));

function isObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function flattenKeys(node, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(node || {})) {
    const full = prefix ? prefix + '.' + k : k;
    if (isObject(v)) flattenKeys(v, full, out);
    else out.add(full);
  }
  return out;
}
const schemaKeys = flattenKeys(SCHEMA);

const missing = [...used].filter(k => !schemaKeys.has(k));
if (missing.length) {
  console.error('SCHEMA is missing used keys:');
  missing.forEach(k => console.error('  - ' + k));
  process.exit(1);
}

const orphan = [...schemaKeys].filter(k => !used.has(k));
if (orphan.length) {
  console.warn('SCHEMA has ' + orphan.length + ' orphan keys (not used in src/app):');
  orphan.forEach(k => console.warn('  - ' + k));
}

console.log('Schema leaves: ' + schemaKeys.size + ' | Used: ' + used.size);
