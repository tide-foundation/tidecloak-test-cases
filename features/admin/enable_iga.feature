Feature: Enable IGA in admin console
    As a Tide Cloak admin user
    I want to enable Identity Governance and Administration (IGA) 

  Scenario: Admin enables IGA
    Given the admin is logged in to the Tidecloak admin console
    When the admin enables IGA 
    Then table in change request for clients is visible