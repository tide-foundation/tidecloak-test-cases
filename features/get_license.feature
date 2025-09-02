Feature: Add Tide as Identity provider and get license in Tidecloak
    As a Tide Cloak admin user
    I want Tide as am Identity provider

  Scenario: Admin adds Tide provider to realm and get license
    Given the admin in the tide admin console selects realm <realm_name>
    When the admin adds Tide provider to the realm and subscribe to tide with <email> and get license 
    Then the realm <realm_name> should have a visible license details

  Examples:
      | realm_name | email | 
      | testrealm  | admin@tide.org  |