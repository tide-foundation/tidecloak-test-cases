Feature: Delete license  and delete tide as Identity provider in tidecloak
  As a tide cloak admin user
  I want to remove tide as am Identity provider

  @realm_teardown
  Scenario: Admin deletes the license and deletes tide provider
    Given the admin in the tide admin console selects realm <realm_name>
    When the admin deletes license with and deletes tide provider in realm
    Then the realm <realm_name> should have all providers visible in the Identity provider page

    Examples:
      | realm_name |
      | testrealm  |