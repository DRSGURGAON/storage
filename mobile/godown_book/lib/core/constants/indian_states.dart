/// India's 28 states + 8 Union Territories (verified 2026 - India's
/// state/UT count has been unchanged since the 2020 merger of Dadra
/// and Nagar Haveli with Daman and Diu, following the 2019 Jammu and
/// Kashmir reorganisation).
///
/// A single shared list so every document's own State field (Warehouse
/// Receipt, Bill, Customer, Company Profile) offers identical, correct
/// suggestions - rather than each screen inventing its own partial
/// list that could quietly drift out of sync with the others.
const List<String> kIndianStatesAndUnionTerritories = [
  // States (28)
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  // Union Territories (8)
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
];
