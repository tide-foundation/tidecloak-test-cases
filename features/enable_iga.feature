Feature: Enable IGA in admin console
  As a Tide Cloak admin user
  I want to enable Identity Governance and Administration (IGA)

  Scenario: Admin enables IGA
    Given the admin in the tide admin console selects realm <realm_name>
    When the admin enables IGA for the realm
    Then the table in change request for clients is visible

    Examples:
      | realm_name |
      | testrealm  |