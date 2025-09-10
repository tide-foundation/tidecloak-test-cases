Feature: Create a new realm in tidecloak
  As a tide Cloak admin user
  I want to create a realm in tidecloak

  @realm_action
  Scenario: Admin creates a new realm successfully
    Given the admin is logged in to the tide admin console
    When the admin creates a realm <realm_name>
    Then the realm <realm_name> should be visible in the realm list

    Examples:

      | realm_name | admin_name |
      | testrealm  | Tide Admin |